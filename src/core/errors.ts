/** Erreurs lisibles par l'utilisateur, avec un code stable exploitable par l'interface. */
export class UserError extends Error {
  readonly code: string;
  readonly details?: string;

  constructor(message: string, code = 'APP_ERROR', details?: string) {
    super(message);
    this.name = 'UserError';
    this.code = code;
    this.details = details;
  }
}

export class ConflictError extends UserError {
  readonly suggestedName?: string;

  constructor(message: string, suggestedName?: string) {
    super(message, 'CONFLICT');
    this.name = 'ConflictError';
    this.suggestedName = suggestedName;
  }
}

export class CancelledError extends UserError {
  constructor(message = 'Opération annulée.') {
    super(message, 'CANCELLED');
    this.name = 'CancelledError';
  }
}

const ERRNO_MESSAGES: Record<string, string> = {
  EACCES: 'Accès refusé. Vérifiez les droits du fichier ou du dossier.',
  EPERM: 'Opération non autorisée par le système.',
  ENOENT: 'Fichier ou dossier introuvable.',
  EISDIR: 'Un fichier était attendu, mais il s’agit d’un dossier.',
  ENOTDIR: 'Un dossier était attendu, mais il s’agit d’un fichier.',
  ENOSPC: 'Espace disque insuffisant pour terminer l’opération.',
  EROFS: 'Le disque est en lecture seule.',
  EMFILE: 'Trop de fichiers ouverts simultanément. Réessayez.',
  ENAMETOOLONG: 'Le chemin du fichier est trop long.',
  EBUSY: 'Le fichier est utilisé par un autre programme.',
  EEXIST: 'Un fichier ou dossier portant ce nom existe déjà.',
  EIO: 'Erreur d’entrée/sortie du disque.',
};

export function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return 'UNKNOWN';
}

export function describeError(error: unknown, context?: string): string {
  if (error instanceof UserError) return error.message;
  const code = errorCode(error);
  const friendly = ERRNO_MESSAGES[code];
  if (friendly) {
    const detail = error instanceof Error && error.message ? ` (${error.message})` : '';
    return context ? `${context} : ${friendly}${detail}` : `${friendly}${detail}`;
  }
  if (error instanceof Error) {
    return context ? `${context} : ${error.message}` : error.message;
  }
  return context ? `${context} : erreur inconnue.` : 'Erreur inconnue.';
}

export function toUserError(error: unknown, context?: string): UserError {
  if (error instanceof UserError) return error;
  return new UserError(describeError(error, context), errorCode(error));
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof CancelledError ||
    (error instanceof Error && (error.name === 'AbortError' || error.message === 'ABORT_ERR'))
  );
}
