import { useId, useRef, useState } from 'react';
import { FileUp, Trash2, UploadCloud } from 'lucide-react';
import Field from './Field';
import TechnicalValue from './TechnicalValue';

const formatFileSize = (bytes) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const FileUpload = ({
  id,
  label,
  helperText,
  error,
  required = false,
  disabled = false,
  accept,
  multiple = false,
  files,
  defaultFiles = [],
  onFilesChange,
  selectLabel = 'בחירת קובץ',
  dropLabel = 'גרירת קובץ לכאן או בחירה מהמחשב',
  className = '',
}) => {
  const generatedId = useId().replaceAll(':', '');
  const inputId = id || `file-upload-${generatedId}`;
  const inputRef = useRef(null);
  const [internalFiles, setInternalFiles] = useState(defaultFiles);
  const [dragging, setDragging] = useState(false);
  const selectedFiles = files ?? internalFiles;

  const commitFiles = (nextFiles) => {
    const normalized = multiple ? nextFiles : nextFiles.slice(0, 1);
    if (files === undefined) setInternalFiles(normalized);
    onFilesChange?.(normalized);
  };

  const handleSelection = (event) => {
    commitFiles([...event.target.files]);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    if (!disabled) commitFiles([...event.dataTransfer.files]);
  };

  const removeFile = (index) => {
    commitFiles(selectedFiles.filter((_, fileIndex) => fileIndex !== index));
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <Field
      id={inputId}
      label={label}
      helperText={helperText}
      error={error}
      required={required}
      disabled={disabled}
      className={`ui-file-upload ${className}`.trim()}
      controlClassName="ui-file-upload-control"
      unstyledControl
    >
      {({ controlId, ariaProps }) => (
        <div className="ui-file-upload-content">
          <input
            {...ariaProps}
            ref={inputRef}
            id={controlId}
            className="ui-file-native"
            type="file"
            accept={accept}
            multiple={multiple}
            disabled={disabled}
            required={required && selectedFiles.length === 0}
            onChange={handleSelection}
          />
          <div
            className={`ui-file-dropzone${dragging ? ' is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <UploadCloud size={24} aria-hidden="true" />
            <strong>{dropLabel}</strong>
            {accept && <TechnicalValue className="ui-file-accept">{accept}</TechnicalValue>}
            <button type="button" className="ui-file-select" disabled={disabled} onClick={() => inputRef.current?.click()}>
              <FileUp size={17} aria-hidden="true" />
              {selectLabel}
            </button>
          </div>

          {selectedFiles.length > 0 && (
            <ul className="ui-file-list" aria-label="קבצים שנבחרו">
              {selectedFiles.map((file, index) => (
                <li key={`${file.name}-${file.size}-${index}`}>
                  <span className="ui-file-summary">
                    <TechnicalValue>{file.name}</TechnicalValue>
                    <TechnicalValue className="ui-file-size">{formatFileSize(file.size)}</TechnicalValue>
                  </span>
                  <button
                    type="button"
                    className="ui-file-remove"
                    disabled={disabled}
                    aria-label={`הסרת ${file.name}`}
                    onClick={() => removeFile(index)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Field>
  );
};

export default FileUpload;

