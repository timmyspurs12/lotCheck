import { useState, type DragEvent, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FileUp, Link2, LoaderCircle, UploadCloud } from 'lucide-react';
import { api, isApiError } from '../api/client';
import type { EvidenceRole } from '../api/types';
import { ApiErrorState, Button } from './ui';

export function EvidenceUploader({ reviewId, disabled = false, onUploaded }: { reviewId: string; disabled?: boolean; onUploaded?: () => void }) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState<EvidenceRole>('PROJECT');
  const [file, setFile] = useState<File | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const mutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Choose a file before uploading.');
      return api.uploadEvidence(reviewId, file, role, sourceUrl.trim() || undefined);
    },
    onSuccess: async () => {
      setFile(null);
      setSourceUrl('');
      const input = document.getElementById(`evidence-file-${reviewId}`) as HTMLInputElement | null;
      if (input) input.value = '';
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['review', reviewId] }),
        queryClient.invalidateQueries({ queryKey: ['reviews'] }),
        queryClient.invalidateQueries({ queryKey: ['sites'] }),
      ]);
      onUploaded?.();
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.mutate();
  };
  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled || mutation.isPending) return;
    const droppedFile = event.dataTransfer.files?.[0];
    if (droppedFile) setFile(droppedFile);
  };

  return (
    <form className="evidence-uploader" onSubmit={handleSubmit}>
      <fieldset className="role-choice" disabled={disabled || mutation.isPending}>
        <legend>Evidence role</legend>
        <label className={role === 'PROJECT' ? 'role-option role-option-active' : 'role-option'}>
          <input type="radio" name={`role-${reviewId}`} value="PROJECT" checked={role === 'PROJECT'} onChange={() => setRole('PROJECT')} />
          <span className="role-option-marker" /><span><strong>Project evidence</strong><small>Close-out or milestone claim</small></span>
        </label>
        <label className={role === 'INDEPENDENT' ? 'role-option role-option-active' : 'role-option'}>
          <input type="radio" name={`role-${reviewId}`} value="INDEPENDENT" checked={role === 'INDEPENDENT'} onChange={() => setRole('INDEPENDENT')} />
          <span className="role-option-marker" /><span><strong>Independent evidence</strong><small>Separate review or supporting record</small></span>
        </label>
      </fieldset>

      <label className={`file-drop-zone ${file ? 'file-drop-zone-selected' : ''} ${dragging ? 'file-drop-zone-dragging' : ''} ${disabled ? 'file-drop-zone-disabled' : ''}`} htmlFor={`evidence-file-${reviewId}`} onDragEnter={(event) => { event.preventDefault(); if (!disabled && !mutation.isPending) setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }} onDrop={handleDrop}>
        <input id={`evidence-file-${reviewId}`} type="file" disabled={disabled || mutation.isPending} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
        <span className="file-drop-icon">{file ? <FileUp size={18} /> : <UploadCloud size={18} />}</span>
        <span className="file-drop-copy"><strong>{file ? file.name : 'Choose a document'}</strong><small>{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB · ${file.type || 'file type not detected'}` : 'Select a source file from your device'}</small></span>
        <span className="file-browse">Browse</span>
      </label>

      <label className="field-label source-url-field"><span>Source reference <em>Optional</em></span><span className="text-input-wrap"><Link2 size={14} /><input type="url" inputMode="url" value={sourceUrl} disabled={disabled || mutation.isPending} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://…" /></span></label>
      {mutation.isError && <ApiErrorState error={mutation.error} compact />}
      <div className="uploader-footer"><p>Document references, processing details, and hashes will appear only when returned by the API.</p><Button type="submit" disabled={disabled || !file || mutation.isPending} icon={mutation.isPending ? <LoaderCircle size={14} className="spin" /> : <FileUp size={14} />}>{mutation.isPending ? 'Uploading…' : 'Upload evidence'}</Button></div>
      {mutation.isSuccess && <div className="upload-success" role="status">Evidence uploaded. The review details are refreshing from the API.</div>}
      {mutation.isError && !isApiError(mutation.error) && <div className="field-error" role="alert">{mutation.error.message}</div>}
    </form>
  );
}
