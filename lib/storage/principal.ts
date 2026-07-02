/** Identifies whose data a storage operation targets, and where it lives.
 *  Local: id is the fixed sentinel, outputFolder is the on-disk data root.
 *  Cloud (later): id is the owner user id; outputFolder is unused. */
export interface Principal {
  readonly id: string;
  readonly outputFolder: string;
}

export const LOCAL_PRINCIPAL_ID = 'local';

export function localPrincipal(outputFolder: string): Principal {
  return { id: LOCAL_PRINCIPAL_ID, outputFolder };
}
