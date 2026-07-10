export function buildSourceRevisionFingerprint(args: {
  documentId?: string | null;
  sourceLength: number;
  sourceRevision?: number | null;
}): string | undefined {
  if (!args.documentId || args.sourceRevision == null) {
    return undefined;
  }
  return `source-revision:${args.documentId}:${args.sourceRevision}:${args.sourceLength}`;
}

export function buildSnapshotEditSourceFingerprint(args: {
  documentId?: string | null;
  sourceLength: number;
  sourceRevision?: number | null;
  sourceRefs?: readonly { sourceFingerprint?: string }[];
}): string | undefined {
  const sourceFingerprint = buildSourceRevisionFingerprint(args);
  if (!sourceFingerprint) {
    return undefined;
  }
  const existingFingerprint = args.sourceRefs?.find((sourceRef) => sourceRef.sourceFingerprint)?.sourceFingerprint;
  return existingFingerprint == null || existingFingerprint === sourceFingerprint ? sourceFingerprint : undefined;
}
