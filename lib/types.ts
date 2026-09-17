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
  cached: boolean;
}

export interface FilesPageResponse {
  items: FileRecord[];
  total: number;
  page: number;
  pageSize: number;
}
