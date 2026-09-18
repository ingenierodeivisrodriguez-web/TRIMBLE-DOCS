export interface TrimbleUserRef {
  id?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface FileRecord {
  id: string;
  name: string;
  ext: string;
  size: number;
  modifiedOn: string;
  uploadedBy: string;
  folderPath: string;
  /** Version id of the latest version, used to deep-link into the TC web viewer. */
  versionId: string;
  /** Revision number of the latest version, shown to the user as "v{version}". */
  version: number;
}

export interface ProjectMeta {
  id: string;
  name: string;
  createdOn: string;
}

export interface ProjectData {
  project: ProjectMeta;
  files: FileRecord[];
  fetchedAt: number;
}

export interface TypeAggregate {
  ext: string;
  count: number;
  size: number;
}

export interface TimelinePoint {
  date: string;
  cumulative: number;
}

export interface SummaryResponse {
  project: ProjectMeta;
  totals: {
    filesCount: number;
    typesCount: number;
    totalSize: number;
  };
  byType: TypeAggregate[];
  timeline: {
    weekly: TimelinePoint[];
    monthly: TimelinePoint[];
  };
}

export interface FilesListResponse {
  items: FileRecord[];
  total: number;
}
