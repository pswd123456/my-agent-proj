export type StudyPlanStatus =
  | "draft"
  | "active"
  | "paused"
  | "completed"
  | "cancelled";

export interface StudyPlan {
  id: string;
  title: string;
  status: StudyPlanStatus;
}
