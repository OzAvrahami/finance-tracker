"""Build clean local Linux artifacts; never deploy or read application env files.

Run from any directory: python docs/operations/verify_deployment_package.py
Requires Docker and network for public base images/npm install only. Runtime
checks have --network none and dummy configuration; no database is contacted.
"""
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[2]
OVERLAYS = ("Dockerfile.backend", ".dockerignore", "railway.json", "client/vercel.json")


def run(*args, **kwargs):
    return subprocess.run(args, check=True, text=True, **kwargs)


def output(*args):
    return subprocess.check_output(args, text=True).strip()


def verify():
    suffix = uuid.uuid4().hex[:12]
    backend, frontend = "ft-package-back-" + suffix, "ft-package-front-" + suffix
    images = []
    containers = []
    checks = 0

    def passed(description):
        nonlocal checks
        checks += 1
        print(f"PASS {checks}: {description}", flush=True)

    # Export only committed files, overlay the four reviewed packaging files.
    # No owner/untracked files, local node_modules or environment files are read.
    with tempfile.TemporaryDirectory(prefix="finance-tracker-package-") as directory:
        base = pathlib.Path(directory).resolve()
        assert base.parent == pathlib.Path(tempfile.gettempdir()).resolve()
        archive = subprocess.check_output(["git", "-C", str(ROOT), "archive", "HEAD"])
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                path = pathlib.PurePosixPath(member.name)
                if ("node_modules" in path.parts or any(".env" in p for p in path.parts)
                        or not member.isfile()):
                    continue
                target = (base / member.name).resolve()
                assert target.is_relative_to(base)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(tar.extractfile(member).read())
        for relative in OVERLAYS:
            (base / relative).write_bytes((ROOT / relative).read_bytes())
        locks = {p: hashlib.sha256((base / p).read_bytes()).hexdigest()
                 for p in ("server/package-lock.json", "client/package-lock.json")}
        assert not list(base.rglob("node_modules")) and not list(base.rglob(".env*"))
        passed("clean git export, reviewed overlays, no local dependencies/env/untracked data")
        config = json.loads((base / "railway.json").read_text())
        assert config["build"]["builder"] == "DOCKERFILE"
        assert config["deploy"]["startCommand"] == "npm --prefix server start"
        assert config["deploy"]["healthcheckPath"] == "/health"
        assert "/shared/**" in config["build"]["watchPatterns"]
        assert json.loads((base / "server/package.json").read_text())["scripts"]["start"] == "node index.js"
        client = json.loads((base / "client/vercel.json").read_text())
        assert client["installCommand"] == "npm ci --include=dev --no-audit --no-fund"
        assert client["buildCommand"] == "npm run build" and client["outputDirectory"] == "dist"
        passed("provider commands/config agree with actual package scripts")
        try:
            run("docker", "build", "--pull", "-f", str(base / "Dockerfile.backend"), "-t", backend, str(base))
            images.append(backend)
            run("docker", "run", "--rm", "--network", "none", backend, "node", "-e",
                "const a=require('assert');const v=process.versions.node.split('.').map(Number);"
                "a(v[0]===22&&v[1]>=12);console.log('Node',process.version);"
                "require('./shared/receiptPricing.mjs');require('./shared/shoppingQuantities.mjs');"
                "require('./server/services/shoppingHabitsService');"
                "require('./server/services/shoppingProductLookup');"
                "require('./server/services/shoppingCommercialProducts');"
                "const fs=require('fs');for(const p of ['client','docs','.git','server/.env','server/test','server/migrations'])a(!fs.existsSync(p),p)")
            passed("Linux Node 22 supported; shared/runtime modules resolve; backend excludes client/local artifacts")
            container = backend + "-health"
            run("docker", "run", "-d", "--name", container, "--network", "none",
                "-e", "SUPABASE_URL=http://127.0.0.1:9", "-e", "SUPABASE_KEY=packaging-dummy-key",
                "-e", "EXTERNAL_API_KEY=packaging-dummy-external", "-e", "LOAN_JOB_SECRET=packaging-dummy-job",
                "-e", "SAVINGS_JOB_ENABLED=false", "-e", "APPLE_PAY_INGESTION_ENABLED=false",
                "-e", "FLOWLINK_INGESTION_ENABLED=false", "-e", "PORT=5050", backend)
            containers.append(container)
            for attempt in range(30):
                result = subprocess.run(["docker", "exec", container, "node", "-e",
                    "fetch('http://127.0.0.1:5050/health').then(async r=>{if(r.status!==200||await r.text()!=='OK')process.exit(1)}).catch(()=>process.exit(1))"],
                    capture_output=True)
                if result.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError("Backend health failed: " + output("docker", "logs", container))
            passed("exact npm startup and HTTP /health=200 OK with network disabled and dummy config")
            # Frontend context models client root WITH outside-root shared sources.
            # Override backend-only .dockerignore for this local verification build.
            dockerfile = base / "Dockerfile.frontend-check"
            dockerfile.write_text('''FROM node:22-bookworm-slim
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund
COPY client/ ./
COPY shared/ /app/shared/
ENV VITE_API_URL=http://127.0.0.1:5050/api VITE_SUPABASE_URL=http://127.0.0.1:9 VITE_SUPABASE_ANON_KEY=packaging-public-anon
ENV SUPABASE_KEY=SERVER_ONLY_PACKAGE_SENTINEL SHOPPING_RECEIPT_OPENAI_KEY=OCR_ONLY_PACKAGE_SENTINEL LOAN_JOB_SECRET=JOB_ONLY_PACKAGE_SENTINEL
RUN npm run build
''', encoding="utf-8")
            pathlib.Path(str(dockerfile) + ".dockerignore").write_text(
                "**\n!client/\n!client/**\n!shared/\n!shared/**\n**/node_modules\n**/.env*\n", encoding="utf-8")
            run("docker", "build", "-f", str(dockerfile), "-t", frontend, str(base))
            images.append(frontend)
            passed("frontend locked install/build with client root and root shared source, no existing node_modules")
            run("docker", "run", "--rm", "--network", "none", frontend, "node", "-e",
                "const fs=require('fs'),a=require('assert');let text='';"
                "function walk(p){for(const e of fs.readdirSync(p,{withFileTypes:true})){const n=p+'/'+e.name;if(e.isDirectory())walk(n);else text+=fs.readFileSync(n,'utf8')}}"
                "walk('dist');for(const x of ['SERVER_ONLY_PACKAGE_SENTINEL','OCR_ONLY_PACKAGE_SENTINEL','JOB_ONLY_PACKAGE_SENTINEL'])a(!text.includes(x),x);"
                "a(text.includes('http://127.0.0.1:5050/api'));a(!fs.existsSync('/app/server'));")
            passed("client bundle excludes server secret sentinels and server tree; uses explicit isolated public API URL")
            for p, digest in locks.items():
                assert hashlib.sha256((base / p).read_bytes()).hexdigest() == digest
            passed("both committed dependency lockfiles unchanged")
            print(f"RESULT: {checks}/{checks} packaging checks passed; local Docker artifacts only, no provider deployment.")
        finally:
            for container in containers:
                run("docker", "rm", "-f", container, stdout=subprocess.DEVNULL)
            for image in images:
                run("docker", "image", "rm", image, stdout=subprocess.DEVNULL)


if __name__ == "__main__":
    verify()
