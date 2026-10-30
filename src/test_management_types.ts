export type Ref = { Id: number; Name?: string }
export type State = Ref & { IsFinal?: boolean; IsInitial?: boolean }
export type PlanRun = Ref & {
  TestPlan: Ref; Project: Ref; EntityState: State; Description?: string
  ParentTestPlanRun?: Ref; ParentTestPlanRuns?: { Items: Ref[] }
  PassedCount?: number; FailedCount?: number; NotRunCount?: number
}
export type CaseRun = Ref & {
  TestPlanRun: Ref; TestCase: Ref; Status?: string | null; Comment?: string
  LastExecutor?: Ref; RunDate?: string; StartRunDate?: string; EndRunDate?: string
}
export type StepRun = Ref & {
  TestCaseRun: Ref; Passed?: boolean | null; Runned?: boolean; Status?: string | null; Description?: string; Result?: string; RunOrder?: number
}
export type Attachment = Ref & {
  General: Ref; MimeType?: string; Uri?: string; Size?: number
}
export type ExecutionInput = {
  id: string; status: string; comment: string; evidenceAttachmentIds?: string[]
}
