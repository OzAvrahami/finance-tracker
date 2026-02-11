const { ZodError } = require("zod");

function validateBody(schema) {
    return (req, res, next) => {
        try {
            req.body = schema.parse(req.body);
            next();
        } catch (e) {
            if (e instanceof ZodError) {
                return res.status(400).json({
                    error: "Validation failed",
                    details: e.errors.map(x => ({
                        path: x.path.join("."),
                        message: x.message
                    }))
                });
            }
            next(e);
        }
    };
}

module.exports = { validateBody };
