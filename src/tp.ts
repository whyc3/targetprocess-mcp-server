import { readFileSync } from "fs";
import { basename } from "path";
import {
  TpClientParameters,
  TpResponse,
  TpResult,
  Relation,
  BugInputSchema,
  Bug,
  Task,
  LoggedUser,
  SearchEntitiesParams,
  RoleAssignment,
  TestPlan,
  TestCase,
  TestStep,
} from "./types.js";
import { config } from "./config.js";
import { TpHttp, TpApiError, errorDetails, type Query } from "./http.js";
import { applyTagMutation, hasTagMutation, type TagMutationParams, type TaggableEntityType } from "./tags.js";

type TestPlanNode = {
  id: string
  numericId: number
  name?: string
}

export type TestCaseMoveResult = {
  dryRun: boolean
  sourceTestPlanId: string
  destinationTestPlanId: string
  requestedTestCaseIds: string[]
  eligibleTestCaseIds: string[]
  missingFromSourceTestCaseIds: string[]
  canMove: boolean
  reason?: string
  movedTestCaseIds: string[]
  failedToAssign: Array<{ id: string, reason: string }>
  retainedInSourceTestCaseIds: string[]
  restoredToSourceTestCaseIds: string[]
  unassignedWithoutDestinationTestCaseIds: string[]
  unverifiedMoveTestCaseIds: string[]
}

export type TestCasePlanLink = { id: string, name?: string }

export type TestCaseUnlinkResult = {
  dryRun: boolean
  testPlanId: string
  requestedTestCaseIds: string[]
  eligibleTestCaseIds: string[]
  missingFromTestPlanTestCaseIds: string[]
  canUnlink: boolean
  unlinkedTestCaseIds: string[]
  retainedInTestPlanTestCaseIds: string[]
  unverifiedTestCaseIds: string[]
  httpStatus?: number
  responseBody?: string
  reason?: string
}

export type TestCaseBatchMoveResult = {
  dryRun: boolean
  sourceTestPlanId: string
  destinationTestPlanId: string
  batchSize: number
  requestedTestCaseIds: string[]
  movedTestCaseIds: string[]
  unprocessedTestCaseIds: string[]
  batches: TestCaseMoveResult[]
  canMove: boolean
  reason?: string
}

type BulkTagUpdateSuccess<T> = {
  id: string
  response: T
}

type BulkTagUpdateFailure = {
  id: string
  reason: string
}

export type CompatibleCaseMoveResult = TestCaseMoveResult & { parentTestPlanId?: string; alreadyInDestinationTestCaseIds: string[]; unprocessedTestCaseIds: string[] }
export type ChildPlanUnlinkResult = { dryRun: boolean; parentTestPlanId: string; childTestPlanId: string; canUnlink: boolean; unlinked: boolean; missingDirectTestCaseIdsAfter: string[]; directTestCaseCountBefore?: number; reason?: string; httpStatus?: number; responseBody?: string }

export class TpClient {

  private readonly v1 = '/api/v1'
  private readonly v2 = '/api/v2'
  private readonly http = new TpHttp()

  async api<T>(method: 'GET' | 'POST' | 'DELETE', path: string[], data?: unknown, query: Query = {}): Promise<T> {
    return this.http.request<T>(method, this.v1 + '/' + path.map(encodeURIComponent).join('/'), { format: 'json', ...query }, data)
  }

  async apiAll<T>(path: string[], query: Query = {}): Promise<T[]> {
    const items: T[] = []
    for (let skip = 0; skip < 1000000; skip += 100) {
      const page = await this.api<TpResponse<T>>('GET', path, undefined, { ...query, take: 100, skip })
      if (!page || !Array.isArray(page.Items)) throw new Error('Invalid collection response for ' + path.join('/'))
      items.push(...page.Items)
      if (!page.Next) return items
      if (!page.Items.length) throw new Error('Pagination returned an empty page with a next page')
    }
    throw new Error('Pagination limit reached; narrow the query')
  }

  private async processId(): Promise<string> {
    if (config.tp.processId) return config.tp.processId
    if (config.tp.projectId) {
      const project = await this.api<{ Process?: { Id: number } }>('GET', ['Projects', config.tp.projectId])
      if (project?.Process?.Id) return String(project.Process.Id)
    }
    throw new Error('Set TP_PROJECT_ID or TP_PROCESS_ID to resolve the project workflow')
  }

  // @ts-ignore -- retained for existing consumers
  private async getAll<T>(params: TpClientParameters): Promise<T[]> {
    return (await this.getAllOrNull<T>(params)) || []
  }

  private async getAllOrNull<T>(params: TpClientParameters): Promise<T[] | null> {
    const items: T[] = []
    for (let skip = 0; skip < 1000000; skip += 100) {
      const page = await this.get<TpResponse<T>>({ ...params, param: { ...params.param, take: 100, skip } })
      if (!page) return null
      items.push(...page.Items)
      if (!page.Next) return items
      if (!page.Items.length) throw new Error('Invalid pagination response')
    }
    throw new Error('Pagination limit reached')
  }

  private get<T>(params: TpClientParameters): Promise<T> {
    return this.http.request<T>('GET', (params.apiVersion || this.v1) + '/' + params.pathParam.map(encodeURIComponent).join('/'), params.param)
  }

  private post<T, U>(params: TpClientParameters, data: T, _options: { throwOnError?: boolean } = {}): Promise<U> {
    return this.http.request<U>('POST', (params.apiVersion || this.v1) + '/' + params.pathParam.map(encodeURIComponent).join('/'), params.param, data)
  }

  // Compensation paths retain explicit partial-result reporting.
  private async tryPost<T, U>(params: TpClientParameters, data: T): Promise<U | null> {
    try { return await this.post<T, U>(params, data) } catch { return null }
  }

  private async postRaw<T, U>(params: TpClientParameters, data: T): Promise<TpResult<U>> {
    try { return { ok: true, data: await this.post<T, U>(params, data) } }
    catch (error) { return { ok: false, status: error instanceof TpApiError ? error.status : 0, body: error instanceof TpApiError ? error.body : JSON.stringify(errorDetails(error)) } }
  }

  private async del<U>(params: TpClientParameters): Promise<TpResult<U>> {
    try { return { ok: true, data: await this.http.request<U>('DELETE', (params.apiVersion || this.v1) + '/' + params.pathParam.map(encodeURIComponent).join('/'), params.param) } }
    catch (error) { return { ok: false, status: error instanceof TpApiError ? error.status : 0, body: error instanceof TpApiError ? error.body : JSON.stringify(errorDetails(error)) } }
  }
  private escapeWhereValue(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")
  }

  private buildEqFilter(field: string, value: string): string {
    if (/^\d+$/.test(value)) {
      return `${field} eq ${value}`
    }

    return `${field} eq '${this.escapeWhereValue(value)}'`
  }

  private buildSearchWhereClause({ field, keyword, filters }: Pick<SearchEntitiesParams, "field" | "keyword" | "filters">): string {
    const clauses: string[] = [`${field} contains '${this.escapeWhereValue(keyword)}'`]

    if (filters?.entityStateName) {
      clauses.push(`EntityState.Name eq '${this.escapeWhereValue(filters.entityStateName)}'`)
    }

    if (filters?.projectId) {
      clauses.push(this.buildEqFilter("Project.Id", filters.projectId))
    }

    if (filters?.ownerId) {
      clauses.push(this.buildEqFilter("Owner.Id", filters.ownerId))
    }

    if (filters?.releaseId) {
      clauses.push(this.buildEqFilter("Release.Id", filters.releaseId))
    }

    if (filters?.createdAfter) {
      clauses.push(`CreateDate gte '${this.escapeWhereValue(filters.createdAfter)}'`)
    }

    if (filters?.createdBefore) {
      clauses.push(`CreateDate lte '${this.escapeWhereValue(filters.createdBefore)}'`)
    }

    if (filters?.modifiedAfter) {
      clauses.push(`ModifyDate gte '${this.escapeWhereValue(filters.modifiedAfter)}'`)
    }

    if (filters?.modifiedBefore) {
      clauses.push(`ModifyDate lte '${this.escapeWhereValue(filters.modifiedBefore)}'`)
    }

    for (const tag of filters?.tags ?? []) {
      clauses.push(`Tags contains '${this.escapeWhereValue(tag)}'`)
    }

    return clauses.join(" and ")
  }

  private async resolveUpdatedTags(entityType: TaggableEntityType, id: string, params: TagMutationParams): Promise<string | undefined | null> {
    if (!hasTagMutation(params)) {
      return undefined
    }

    if (params.tags !== undefined) {
      return applyTagMutation(undefined, params)
    }

    const currentTags = await this.getEntityTags(entityType, id)
    if (currentTags === null) {
      return null
    }

    return applyTagMutation(currentTags, params)
  }

  private async getEntityTags(entityType: TaggableEntityType, id: string): Promise<string | undefined | null> {
    if (entityType === "UserStory") {
      const entity = await this.getUserStory<{ Tags?: string }>(id)
      return entity ? entity.Tags : null
    }

    if (entityType === "Bug") {
      const entity = await this.getBug<{ Tags?: string }>(id)
      return entity ? entity.Tags : null
    }

    if (entityType === "Feature") {
      const entity = await this.getFeature<{ Tags?: string }>(id)
      return entity ? entity.Tags : null
    }

    if (entityType === "TestCase") {
      const entity = await this.getTestCase<{ Tags?: string }>(id)
      return entity ? entity.Tags : null
    }

    const entity = await this.getEpic<{ Tags?: string }>(id)
    return entity ? entity.Tags : null
  }

  async getUserStory<T>(userStoryId: string): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["userStories", userStoryId],
      param: { "format": "json" },
    }) as T

    return response
  }

  async getBug<T>(bugId: string): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["bugs", bugId],
      param: { "format": "json" }
    }) as T

    return response
  }

  async getFeature<T>(featureId: string): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["features", featureId],
      param: { "format": "json" }
    }) as T

    return response
  }

  async createBug<T>({ title, card, bugContent, origin = "Manual QA", releaseId, projectId, teamId }: { title: string, card: { id: string, type: "UserStory" | "Bug" | "Feature" }, bugContent: string, origin?: string, releaseId?: string, projectId?: string, teamId?: string }): Promise<T> {
    const bug: Record<string, any> = {
      "Name": title,
      "Project": {
        "Id": projectId || config.tp.projectId
      },
      "assignedTeams": [{
        "team": {
          "id": teamId || config.tp.teamId
        }
      }],
      "Description": bugContent,
    } as any

    if (config.tp.bugOriginField) bug["customFields"] = [{
      "name": config.tp.bugOriginField,
      "type": "DropDown",
      "value": origin
    }]

    if (releaseId) bug["Release"] = { "Id": releaseId }

    if (card.type === "UserStory") {
      bug["UserStory"] = { "Id": card.id }
    } else if (card.type === "Feature") {
      bug["Feature"] = { "Id": card.id }
    }

    return this.post<any, T>({
      pathParam: ["bugs"],
      param: { "format": "json" },
    }, bug, { throwOnError: true }) as T
  }

  async updateUserStorySubState<T>({
    id,
    teamId,
    teamAssignmentId,
    entityStateId
  }: { id: string, teamId?: string, teamAssignmentId?: string, entityStateId?: string }): Promise<T> {
    const userStory: Record<string, any> = { "id": id }

    if (entityStateId) userStory["assignedTeams"] = [{
      "id": teamAssignmentId,
      "team": {
        "id": teamId
      },
      "entityState": {
        "id": entityStateId
      }
    }]

    return this.post<any, T>({
      pathParam: ["UserStories", id],
      param: { "format": "json" },
    }, userStory) as T
  }

  async updateUserStory<T>({
    id,
    title,
    description,
    projectId,
    teamId,
    entityStateId,
    featureId,
    tags,
    addTags,
    removeTags,
    teamIterationId
  }: { id: string, title?: string, description?: string, projectId?: string, teamId?: string, teamAssignmentId?: string, entityStateId?: string, featureId?: string, tags?: string, addTags?: string, removeTags?: string, teamIterationId?: string }): Promise<T> {
    const userStory: Record<string, any> = { "Id": id }

    if (title) userStory["Name"] = title
    if (description) userStory["Description"] = description
    if (projectId) userStory["Project"] = { "Id": projectId }
    if (teamId) userStory["assignedTeams"] = [{ "team": { "id": teamId } }]
    if (entityStateId) userStory["EntityState"] = { "Id": entityStateId }
    if (featureId) userStory["Feature"] = { "Id": featureId }
    const resolvedTags = await this.resolveUpdatedTags("UserStory", id, { tags, addTags, removeTags })
    if (resolvedTags === null) return null as T
    if (resolvedTags !== undefined) userStory["Tags"] = resolvedTags
    if (teamIterationId) userStory["TeamIteration"] = { "Id": teamIterationId }

    return this.post<any, T>({
      pathParam: ["UserStories"],
      param: { "format": "json" },
    }, userStory) as T
  }

  async setBusinessValue<T>({ id, entityType, priorityId }: { id: string, entityType: "UserStories" | "Features" | "Epics", priorityId: string }): Promise<T> {
    const entity = { "Id": id, "Priority": { "Id": priorityId } }
    return this.post<typeof entity, T>({
      pathParam: [entityType, id],
      param: { "format": "json" },
    }, entity) as T
  }

  async updateBug<T>({ id, title, bugContent, origin, releaseId, projectId, teamId, entityStateId, tags, addTags, removeTags, teamIterationId }: { id: string, title?: string, bugContent?: string, origin?: string, releaseId?: string, projectId?: string, teamId?: string, entityStateId?: string, tags?: string, addTags?: string, removeTags?: string, teamIterationId?: string }): Promise<T> {
    const bug: Record<string, any> = { "Id": id }

    if (title) bug["Name"] = title
    if (bugContent) bug["Description"] = bugContent
    if (origin && config.tp.bugOriginField) bug["customFields"] = [{
      "name": config.tp.bugOriginField,
      "type": "DropDown",
      "value": origin
    }]
    if (releaseId) bug["Release"] = { "Id": releaseId }
    if (projectId) bug["Project"] = { "Id": projectId }
    if (teamId) bug["assignedTeams"] = [{
      "team": {
        "id": teamId || config.tp.teamId
      }
    }]
    if (entityStateId) bug["entityState"] = { "id": entityStateId }
    const resolvedTags = await this.resolveUpdatedTags("Bug", id, { tags, addTags, removeTags })
    if (resolvedTags === null) return null as T
    if (resolvedTags !== undefined) bug["Tags"] = resolvedTags
    if (teamIterationId) bug["TeamIteration"] = { "Id": teamIterationId }

    return this.post<any, T>({
      pathParam: ["bugs"],
      param: { "format": "json" },
    }, bug) as T
  }

  async createBugOnly<T>({ title, bugContent, origin = "Manual QA", releaseId, projectId, teamId, entityStateId, tags, teamIterationId }: BugInputSchema): Promise<T> {
    const bug: Record<string, any> = {
      "Name": title,
      "Project": {
        "Id": projectId || config.tp.projectId
      },
      "assignedTeams": [{
        "team": {
          "id": teamId || config.tp.teamId
        }
      }],
      "Description": bugContent,
    }

    if (config.tp.bugOriginField) bug["customFields"] = [{
      "name": config.tp.bugOriginField,
      "type": "DropDown",
      "value": origin
    }]

    if (releaseId) bug["Release"] = { "Id": releaseId }
    if (entityStateId) bug["EntityState"] = { "Id": entityStateId }
    if (tags) bug["Tags"] = tags
    if (teamIterationId) bug["TeamIteration"] = { "Id": teamIterationId }

    return this.post<any, T>({
      pathParam: ["bugs"],
      param: { "format": "json" },
    }, bug, { throwOnError: true }) as T
  }

  async createUserStory<T>({ title, description, featureId, releaseId, projectId, teamId, tags, teamIterationId }: { title: string, description?: string, featureId?: string, releaseId?: string, projectId?: string, teamId?: string, tags?: string, teamIterationId?: string }): Promise<T> {
    const userStory: Record<string, any> = {
      "Name": title,
      "Project": { "Id": projectId || config.tp.projectId },
      "assignedTeams": [{ "team": { "id": teamId || config.tp.teamId } }],
    }

    if (description) userStory["Description"] = description
    if (featureId) userStory["Feature"] = { "Id": featureId }
    if (releaseId) userStory["Release"] = { "Id": releaseId }
    if (tags) userStory["Tags"] = tags
    if (teamIterationId) userStory["TeamIteration"] = { "Id": teamIterationId }

    return this.post<any, T>({
      pathParam: ["UserStories"],
      param: { "format": "json" },
    }, userStory) as T
  }

  async getTeamIterations<T>({ teamId }: { teamId?: string } = {}): Promise<T> {
    return this.get<T>({
      pathParam: ["TeamIterations"],
      param: {
        "format": "json",
        ...(teamId ? { "where": `Team.Id eq ${teamId}` } : {}),
        "include": "[Id,Name,StartDate,EndDate,Team[Id,Name]]",
      },
    }) as T
  }


  async getEpic<T>(epicId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["Epics", epicId],
      param: { "format": "json" },
    }) as T
  }

  async updateEpic<T>({ id, title, description, releaseId, projectId, tags, addTags, removeTags }: { id: string, title?: string, description?: string, releaseId?: string, projectId?: string, tags?: string, addTags?: string, removeTags?: string }): Promise<T> {
    const epic: Record<string, any> = { "Id": id }
    if (title) epic["Name"] = title
    if (description) epic["Description"] = description
    if (projectId) epic["Project"] = { "Id": projectId }
    if (releaseId) epic["Release"] = { "Id": releaseId }

    const resolvedTags = await this.resolveUpdatedTags("Epic", id, { tags, addTags, removeTags })
    if (resolvedTags === null) return null as T
    if (resolvedTags !== undefined) epic["Tags"] = resolvedTags

    return this.post<any, T>({
      pathParam: ["Epics"],
      param: { "format": "json" },
    }, epic) as T
  }

  async getEpicFeatures<T>(epicId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["Features"],
      param: {
        "format": "json",
        "where": `Epic.Id eq ${epicId}`,
        "include": "[Id,Name,Description,EntityState[Name],Team[Name],Release[Name],Progress,Effort]",
        "take": 100,
      },
    }) as T
  }

  async createEpic<T>({ title, description, releaseId, projectId }: { title: string, description?: string, releaseId?: string, projectId?: string }): Promise<T | null> {
    const epic: Record<string, any> = {
      "Name": title,
      "Project": { "Id": projectId || config.tp.projectId },
    }

    if (description) epic["Description"] = description
    if (releaseId) epic["Release"] = { "Id": releaseId }

    return this.post<any, T>({
      pathParam: ["Epics"],
      param: { "format": "json" },
    }, epic)
  }

  async createFeature<T>({ title, description, epicId, releaseId, projectId, teamId }: { title: string, description?: string, epicId?: string, releaseId?: string, projectId?: string, teamId?: string }): Promise<T> {
    const feature: Record<string, any> = {
      "Name": title,
      "Project": { "Id": projectId || config.tp.projectId },
      "assignedTeams": [{ "team": { "id": teamId || config.tp.teamId } }],
    }

    if (description) feature["Description"] = description
    if (epicId) feature["Epic"] = { "Id": epicId }
    if (releaseId) feature["Release"] = { "Id": releaseId }

    return this.post<any, T>({
      pathParam: ["Features"],
      param: { "format": "json" },
    }, feature) as T
  }

  async updateFeature<T>({
    id,
    title,
    description,
    epicId,
    releaseId,
    projectId,
    teamId,
    entityStateId,
    tags,
    addTags,
    removeTags,
    teamIterationId
  }: { id: string, title?: string, description?: string, epicId?: string, releaseId?: string, projectId?: string, teamId?: string, entityStateId?: string, tags?: string, addTags?: string, removeTags?: string, teamIterationId?: string }): Promise<T> {
    const feature: Record<string, any> = { "Id": id }

    if (title) feature["Name"] = title
    if (description) feature["Description"] = description
    if (epicId) feature["Epic"] = { "Id": epicId }
    if (releaseId) feature["Release"] = { "Id": releaseId }
    if (projectId) feature["Project"] = { "Id": projectId }
    if (teamId) feature["assignedTeams"] = [{ "team": { "id": teamId } }]
    if (entityStateId) feature["EntityState"] = { "Id": entityStateId }
    const resolvedTags = await this.resolveUpdatedTags("Feature", id, { tags, addTags, removeTags })
    if (resolvedTags === null) return null as T
    if (resolvedTags !== undefined) feature["Tags"] = resolvedTags
    if (teamIterationId) feature["TeamIteration"] = { "Id": teamIterationId }

    return this.post<any, T>({
      pathParam: ["Features"],
      param: { "format": "json" },
    }, feature) as T
  }

  private updateEntityTagsByType<T>(entityType: TaggableEntityType, id: string, params: TagMutationParams): Promise<T> {
    if (entityType === "UserStory") {
      return this.updateUserStory<T>({ id, ...params })
    }

    if (entityType === "Bug") {
      return this.updateBug<T>({ id, ...params })
    }

    if (entityType === "Feature") {
      return this.updateFeature<T>({ id, ...params })
    }

    if (entityType === "TestCase") {
      return this.updateTestCase<T>({ id, ...params })
    }

    return this.updateEpic<T>({ id, ...params })
  }

  async updateCardTags<T>({ entityType, ids, tags, addTags, removeTags }: { entityType: TaggableEntityType, ids: string[], tags?: string, addTags?: string, removeTags?: string }): Promise<{ succeeded: BulkTagUpdateSuccess<T>[]; failed: BulkTagUpdateFailure[] }> {
    const results = await Promise.all(ids.map(async (id): Promise<
      | { ok: true; id: string; response: T }
      | { ok: false; id: string; reason: string }
    > => {
      try {
        const response = await this.updateEntityTagsByType<T>(entityType, id, { tags, addTags, removeTags })
        if (!response) {
          return { ok: false, id, reason: "Update failed" }
        }

        return { ok: true, id, response }
      } catch (error) {
        return {
          ok: false,
          id,
          reason: error instanceof Error ? error.message : String(error),
        }
      }
    }))

    const succeeded: BulkTagUpdateSuccess<T>[] = []
    const failed: BulkTagUpdateFailure[] = []

    for (const result of results) {
      if (result.ok) {
        succeeded.push({ id: result.id, response: result.response })
        continue
      }

      failed.push({ id: result.id, reason: result.reason })
    }

    return { succeeded, failed }
  }

  async createBugBasedOnUserStory<T>(title: string, userStoryId: string, bugContent: string): Promise<T> {
    const bug: Record<string, any> = {
      "Name": title,
      "Project": {
        "Id": config.tp.projectId
      },
      "UserStory": {
        "Id": userStoryId
      },
      "assignedTeams": [{
        "team": {
          "id": config.tp.teamId
        }
      }],
      "Description": bugContent,
    }

    if (config.tp.bugOriginField) bug["customFields"] = [{
      "name": config.tp.bugOriginField,
      "type": "DropDown",
      "value": "Manual QA"
    }]

    return this.post<any, T>({
      pathParam: ["bugs"],
      param: { "format": "json" },
    }, bug) as T
  }

  async createTestCase<T>(name: string, description: string, testPlanId?: string, options: { projectId?: string; tags?: string } = {}): Promise<T> {
    const plan = testPlanId ? await this.getTestPlan<TestPlan>(testPlanId) : undefined
    if (testPlanId && !plan?.Project?.Id) throw new Error('Cannot resolve the destination test plan project')
    const planProjectId = plan?.Project?.Id === undefined ? undefined : String(plan.Project.Id)
    if (planProjectId && options.projectId && planProjectId !== options.projectId) throw new Error('The requested project differs from the destination test plan project')
    const projectId = planProjectId || options.projectId || config.tp.projectId
    if (!projectId) throw new Error('A projectId is required for a standalone test case')
    return this.post<unknown, T>({ pathParam: ['testCases'], param: { format: 'json' } }, {
      Name: name, Description: description, Project: { Id: projectId },
      ...(testPlanId ? { TestPlans: { Items: [{ Id: testPlanId }] } } : {}),
      ...(options.tags === undefined ? {} : { Tags: options.tags }),
    })
  }
  async deleteTestCase<T>(testCaseId: string): Promise<TpResult<T>> {
    return this.del<T>({
      pathParam: ["testCases", testCaseId],
      param: { "format": "json" },
    })
  }

  async createTestPlan<T>(title: string, resourceId: string, resourceType: 'UserStory' | 'Bug' | 'Feature' = 'UserStory', options?: { description?: string; startDate?: string; endDate?: string; parentTestPlanId?: string; projectId?: string }): Promise<T> {
    const source = await this.api<{ Project?: { Id: number } }>('GET', ['Generals', resourceId])
    const projectId = source?.Project?.Id ? String(source.Project.Id) : options?.projectId || config.tp.projectId
    if (!projectId) throw new Error('Cannot resolve the linked card project')
    if (options?.projectId && options.projectId !== projectId) throw new Error('Project differs from the linked card project')
    if (options?.parentTestPlanId) {
      const parent = await this.getTestPlan<TestPlan>(options.parentTestPlanId)
      if (String(parent.Project?.Id) !== projectId) throw new Error('Parent test plan belongs to another project')
    }
    const testPlan: Record<string, any> = {
      "Name": `Test Plan: ${title}`,
      "Project": {
        "Id": projectId
      },
      "LinkedGeneral": {
        "ResourceType": "General",
        "Id": resourceId,
        "Name": title,
      },
      "LinkedAssignable": {
        "ResourceType": "Assignable",
        "Id": resourceId,
        "Name": title,
      },
    }

    if (resourceType === 'UserStory') {
      testPlan["LinkedUserStory"] = { "ResourceType": "UserStory", "Id": resourceId, "Name": title }
    } else if (resourceType === 'Bug') {
      testPlan["LinkedBug"] = { "ResourceType": "Bug", "Id": resourceId, "Name": title }
    } else if (resourceType === 'Feature') {
      testPlan["LinkedFeature"] = { "ResourceType": "Feature", "Id": resourceId, "Name": title }
    }

    if (options?.description) testPlan["Description"] = options.description
    if (options?.startDate) testPlan["StartDate"] = options.startDate
    if (options?.endDate) testPlan["EndDate"] = options.endDate
    if (options?.parentTestPlanId) testPlan["ParentTestPlans"] = [{ "Id": options.parentTestPlanId }]

    return this.post<any, T>({
      pathParam: ["testPlans"],
      param: { "format": "json" },
    }, testPlan) as T
  }

  async createNestedTestPlan<T>({ title, parentTestPlanId, description }: { title: string, parentTestPlanId: string, description?: string }): Promise<T> {
    const parentTestPlan = await this.getTestPlan<Partial<TestPlan>>(parentTestPlanId)
    if (!parentTestPlan) return null as T

    const testPlan: Record<string, any> = {
      "Name": title,
      "Project": { "Id": parentTestPlan.Project?.Id ?? config.tp.projectId },
      "ParentTestPlans": [{ "Id": parentTestPlanId }],
    }

    if (description !== undefined) testPlan["Description"] = description

    return this.post<any, T>({
      pathParam: ["testPlans"],
      param: { "format": "json" },
    }, testPlan) as T
  }

  async getUser<T>(userId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["Users", userId],
      param: { "format": "json" },
    }) as T
  }

  async getUsers<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Users"],
      param: { "format": "json" },
    }) as T
  }

  async addCommentWithUser<T>(userStoryId: string, comment: string, user: LoggedUser): Promise<T> {
    const userAt = user ? `cc - <div>@user:${user.Email}[${user.FirstName} ${user.LastName}]&nbsp;</div>` : ''
    const commentContent = `${comment}\nn${userAt}`
    const commentData = {
      description: commentContent,
      owner: {
        id: config.tp.ownerId
      },
      general: {
        id: userStoryId,
      },
    }

    return this.post<any, T>({
      pathParam: ["comments"],
      param: { "format": "json" },
    }, commentData) as T
  }

  async addComment<T>(userStoryId: string, comment: string): Promise<T> {
    const commentData = {
      description: comment,
      owner: {
        id: config.tp.ownerId
      },
      general: {
        id: userStoryId,
      },
    }

    return this.post<any, T>({
      pathParam: ["comments"],
      param: { "format": "json" },
    }, commentData) as T
  }

  async addTestStep<T>(testCaseId: string, testStep: { description: string, result: string, runOrder?: number }): Promise<T> {
    const testStepData = {
      "Description": testStep.description,
      "Result": testStep.result,
      "TestCase": { "Id": testCaseId },
      ...(testStep.runOrder === undefined ? {} : { RunOrder: testStep.runOrder }),
    }

    return this.post<any, T>({
      pathParam: ["testSteps"],
      param: { "format": "json" },
    }, testStepData) as T
  }

  async getBugComments<T>(bugId: string, results: number = 25): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["Bugs", bugId, "Comments"],
      param: {
        "format": "json",
        "take": results,
      }
    }) as T

    return response
  }

  async getUserStoryComments<T>(userStoryId: string, results: number = 25): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["UserStories", userStoryId, "Comments"],
      param: {
        "format": "json",
        "take": results,
      }
    }) as T

    return response
  }

  async getFeatureComments<T>(featureId: string, results: number = 25): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["Features", featureId, "Comments"],
      param: {
        "format": "json",
        "take": results,
      }
    }) as T

    return response
  }

  async searchEntities<T>({
    entityType,
    field,
    keyword,
    take = 25,
    skip = 0,
    orderBy,
    orderDirection = "asc",
    filters,
  }: SearchEntitiesParams): Promise<T> {
    const param: Record<string, string | number> = {
      "format": "json",
      "take": take,
      "skip": skip,
      "where": this.buildSearchWhereClause({ field, keyword, filters }),
    }

    if (orderBy) {
      const sortKey = orderDirection === "desc" ? "orderByDesc" : "orderBy"
      param[sortKey] = orderBy
    }

    return this.get<T>({
      pathParam: [entityType],
      param,
    }) as T
  }

  async searchContainsNameText<T>({ text, entityType }: { text: string, entityType: "Generals" | "UserStories" | "Bugs" | "Features" }): Promise<T> {
    return this.searchEntities<T>({
      entityType,
      field: "Name",
      keyword: text,
      take: 25,
      skip: 0,
    })
  }

  async searchContainsDescriptionText<T>({ text, entityType }: { text: string, entityType: "Generals" | "UserStories" | "Bugs" | "Features" }): Promise<T> {
    return this.searchEntities<T>({
      entityType,
      field: "Description",
      keyword: text,
      take: 100,
      skip: 0,
    })
  }

  async getCurrentReleases<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Releases"],
      param: {
        "format": "json",
        "where": `IsCurrent eq 'true'`,
      },
    }) as T
  }

  async getPriorities<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Priorities"],
      param: { "format": "json", "take": "200" },
    }) as T
  }

  async getReleaseUserStories<T>({ name, results = 100, withDescription = false }: { name: string, results?: number, withDescription?: boolean }): Promise<T> {
    const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]"
    return this.get<T>({
      pathParam: ["UserStories"],
      param: {
        "format": "json",
        "take": results,
        "where": `Release.Name eq '${name}'`,
        "include": includeFilter,
      }
    }) as T
  }

  async getReleaseOpenUserStories<T>({ name, results = 300, withDescription = false }: { name: string, results?: number, withDescription?: boolean }): Promise<T> {
    const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]"
    return this.get<T>({
      pathParam: ["UserStories"],
      param: {
        "format": "json",
        "take": results,
        "where": `Release.Name eq '${name}' and EntityState.Name ne 'Closed' and EntityState.Name ne 'Done' and EntityState.Name ne 'Passed Dev01  QA' and EntityState.Name ne 'Ready to Deploy to prod'`,
        "include": includeFilter,
      }
    }) as T
  }

  async getReleaseOpenBugs<T>({ name, results = 300, withDescription = false }: { name: string, results?: number, withDescription?: boolean }): Promise<T> {
    const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]"
    return this.get<T>({
      pathParam: ["Bugs"],
      param: {
        "format": "json",
        "take": results,
        "where": `Release.Name eq '${name}' and EntityState.Name ne 'Closed' and EntityState.Name ne 'Done' and EntityState.Name ne 'Passed Dev01  QA' and EntityState.Name ne 'Ready to Deploy to prod'`,
        "include": includeFilter,
      }
    }) as T
  }

  async getReleaseBugs<T>({ name, results = 500, withDescription = false }: { name: string, results?: number, withDescription?: boolean }): Promise<T> {
    const includeFilter = withDescription ? "[Name, Description, Id, Creator, Owner, Team]" : "[Name, Id]"
    return this.get<T>({
      pathParam: ["Bugs"],
      param: {
        "format": "json",
        "take": results,
        "where": `Release.Name eq '${name}'`,
        "include": includeFilter,
      }
    }) as T
  }

  async getReleaseFeatures<T>({ name, results = 100, withDescription = false }: { name: string, results?: number, withDescription?: boolean }): Promise<T> {
    const includeFilter = withDescription ? "[Name, Description, Id]" : "[Name, Id]"
    return this.get<T>({
      pathParam: ["Features"],
      param: {
        "format": "json",
        "take": results,
        "where": `Release.Name eq '${name}'`,
        "include": includeFilter,
      }
    }) as T
  }

  async getFeatureUserStories<T>(featureId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["features"],
      param: {
        "format": "json",
        "where": `(id==${featureId})`,
        "select": `{userStories}`,
      },
      apiVersion: this.v2
    }) as T
  }

  async getUserStoryBugs<T>(userStoryId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["userstories"],
      param: {
        "format": "json",
        "where": `(id==${userStoryId})`,
        "select": `{bugs}`,
      },
      apiVersion: this.v2
    }) as T
  }

  async getUserStoriesIdsByFeatureId<T>(featureId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["userstories"],
      param: {
        "format": "json",
        "where": `(Feature.Id==${featureId})`,
        "select": `{id}`,
      },
      apiVersion: this.v2
    }) as T
  }

  async getUserStoryTestPlan<T>(userStoryId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["userStories", userStoryId],
      param: {
        "format": "json",
        "select": `{id,storyName:name,linkedtestplan}`,
      },
      apiVersion: this.v2
    }) as T
  }

  async getCardTestPlan<T>(cardId: string, resourceType: 'UserStory' | 'Bug' | 'Feature' = 'UserStory'): Promise<T> {
    const pathMap = { UserStory: "userStories", Bug: "bugs", Feature: "features" }
    return this.get<T>({
      pathParam: [pathMap[resourceType], cardId],
      param: {
        "format": "json",
        "select": `{id,linkedtestplan}`,
      },
    }) as T
  }

  async getTestPlan<T>(testPlanId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["testPlans", testPlanId],
      param: { "format": "json" },
    }) as T
  }

  async getTestPlanTestCases<T>(testPlanId: string): Promise<T> {
    const rootTestPlan = await this.getTestPlan<TestPlan>(testPlanId)
    const rootTestPlanNode = this.toTestPlanNode(rootTestPlan, testPlanId)
    if (!rootTestPlanNode) return null as T

    const queue: TestPlanNode[] = [rootTestPlanNode]
    const visitedPlanIds = new Set<string>()
    const seenTestCaseIds = new Set<string>()
    const testCases: TestCase[] = []

    while (queue.length > 0) {
      const testPlan = queue.shift()!
      if (visitedPlanIds.has(testPlan.id)) continue
      visitedPlanIds.add(testPlan.id)

      const directTestCases = await this.getDirectTestPlanTestCaseItems(testPlan)
      if (!directTestCases) return null as T

      for (const testCase of directTestCases) {
        const testCaseId = String(testCase.Id)
        if (seenTestCaseIds.has(testCaseId)) continue
        seenTestCaseIds.add(testCaseId)
        testCases.push(testCase)
      }

      const childTestPlans = await this.getChildTestPlanNodes(testPlan.id)
      if (!childTestPlans) return null as T

      for (const childTestPlan of childTestPlans) {
        if (!visitedPlanIds.has(childTestPlan.id)) queue.push(childTestPlan)
      }
    }

    return { Next: "", Items: testCases } as T
  }

  async moveTestCasesToSubPlan({
    sourceTestPlanId,
    destinationTestPlanId,
    testCaseIds,
    dryRun = true,
  }: {
    sourceTestPlanId: string
    destinationTestPlanId: string
    testCaseIds: string[]
    dryRun?: boolean
  }): Promise<TestCaseMoveResult> {
    const requestedTestCaseIds = [...new Set(testCaseIds.map(String))]
    const result: TestCaseMoveResult = {
      dryRun,
      sourceTestPlanId,
      destinationTestPlanId,
      requestedTestCaseIds,
      eligibleTestCaseIds: [],
      missingFromSourceTestCaseIds: [],
      canMove: false,
      movedTestCaseIds: [],
      failedToAssign: [],
      retainedInSourceTestCaseIds: [],
      restoredToSourceTestCaseIds: [],
      unassignedWithoutDestinationTestCaseIds: [],
      unverifiedMoveTestCaseIds: [],
    }

    if (sourceTestPlanId === destinationTestPlanId) {
      result.reason = 'Source and destination test plans must be different.'
      return result
    }

    if (requestedTestCaseIds.length !== testCaseIds.length) {
      result.reason = 'Provide each test case ID only once.'
      return result
    }

    const sourceTestCases = await this.getAllOrNull<TestCase>({
      pathParam: ["testPlans", sourceTestPlanId, "testcases"],
      param: { "format": "json" },
    })
    if (!sourceTestCases) {
      result.reason = `Unable to read direct test cases in source test plan ${sourceTestPlanId}.`
      return result
    }

    const sourceTestCaseIds = new Set(sourceTestCases.map((testCase) => String(testCase.Id)))
    result.eligibleTestCaseIds = requestedTestCaseIds.filter((id) => sourceTestCaseIds.has(id))
    result.missingFromSourceTestCaseIds = requestedTestCaseIds.filter((id) => !sourceTestCaseIds.has(id))
    if (result.missingFromSourceTestCaseIds.length > 0) {
      result.reason = 'Every requested test case must be directly assigned to the source test plan.'
      return result
    }

    const isDescendant = await this.isTestPlanDescendant(sourceTestPlanId, destinationTestPlanId)
    if (isDescendant === null) {
      result.reason = `Unable to verify that test plan ${destinationTestPlanId} is nested below ${sourceTestPlanId}.`
      return result
    }
    if (!isDescendant) {
      result.reason = `Destination test plan ${destinationTestPlanId} is not a sub plan of ${sourceTestPlanId}.`
      return result
    }

    result.canMove = true
    if (dryRun) return result

    // Assignment POSTs are additive in Targetprocess. Never add a
    // destination link until every source link was removed and verified.
    const unlinkResult = await this.unlinkTestCasesFromTestPlan({
      testPlanId: sourceTestPlanId,
      testCaseIds: requestedTestCaseIds,
      dryRun: false,
    })

    if (unlinkResult.unlinkedTestCaseIds.length !== requestedTestCaseIds.length) {
      result.retainedInSourceTestCaseIds = unlinkResult.retainedInTestPlanTestCaseIds
      result.unverifiedMoveTestCaseIds = unlinkResult.unverifiedTestCaseIds
      result.reason = `The source link to ${sourceTestPlanId} could not be removed and verified for every selected test case, so no destination links were added. No test cases were deleted or copied.`
      return result
    }

    for (const testCaseId of requestedTestCaseIds) {
      const assigned = await this.tryPost<any, unknown>({
        pathParam: ["testCases", testCaseId],
        param: { "format": "json" },
      }, {
        "TestPlans": { "Items": [{ "Id": destinationTestPlanId }] },
      })

      if (!assigned) {
        result.failedToAssign.push({ id: testCaseId, reason: `Could not assign to test plan ${destinationTestPlanId}.` })
        const restored = await this.tryPost<any, unknown>({
          pathParam: ["testCases", testCaseId],
          param: { "format": "json" },
        }, {
          "TestPlans": { "Items": [{ "Id": sourceTestPlanId }] },
        })

        if (restored) result.restoredToSourceTestCaseIds.push(testCaseId)
        else result.unassignedWithoutDestinationTestCaseIds.push(testCaseId)
        continue
      }

      const planIds = await this.getTestCasePlanIds(testCaseId)
      if (!planIds || !planIds.has(destinationTestPlanId) || planIds.has(sourceTestPlanId)) {
        result.unverifiedMoveTestCaseIds.push(testCaseId)
        continue
      }

      result.movedTestCaseIds.push(testCaseId)
    }

    if (result.failedToAssign.length > 0 || result.unverifiedMoveTestCaseIds.length > 0) {
      result.reason = 'One or more test cases could not be verified as moved. Review the per-case result before continuing.'
    }
    return result
  }

  async getTestCaseTestPlans(testCaseId: string): Promise<TestCasePlanLink[] | null> {
    const testCase = await this.get<Pick<TestCase, 'TestPlans'>>({
      pathParam: ['testCases', testCaseId],
      param: { 'format': 'json', 'include': '[Id,TestPlans[Id,Name]]' },
    })
    if (!testCase?.TestPlans?.Items) return null
    return testCase.TestPlans.Items.map((testPlan) => ({
      id: String(testPlan.Id),
      name: testPlan.Name,
    }))
  }

  async unlinkTestCasesFromTestPlan({
    testPlanId,
    testCaseIds,
    dryRun = true,
  }: {
    testPlanId: string
    testCaseIds: string[]
    dryRun?: boolean
  }): Promise<TestCaseUnlinkResult> {
    const requestedTestCaseIds = [...new Set(testCaseIds.map(String))]
    const result: TestCaseUnlinkResult = {
      dryRun,
      testPlanId,
      requestedTestCaseIds,
      eligibleTestCaseIds: [],
      missingFromTestPlanTestCaseIds: [],
      canUnlink: false,
      unlinkedTestCaseIds: [],
      retainedInTestPlanTestCaseIds: [],
      unverifiedTestCaseIds: [],
    }

    if (requestedTestCaseIds.length !== testCaseIds.length) {
      result.reason = 'Provide each test case ID only once.'
      return result
    }

    const sourceTestCases = await this.getAllOrNull<TestCase>({
      pathParam: ['testPlans', testPlanId, 'testcases'],
      param: { format: 'json' },
    })
    if (!sourceTestCases) {
      result.reason = `Unable to read direct test cases in test plan ${testPlanId}.`
      return result
    }

    const sourceTestCaseIds = new Set(sourceTestCases.map((testCase) => String(testCase.Id)))
    result.eligibleTestCaseIds = requestedTestCaseIds.filter((id) => sourceTestCaseIds.has(id))
    result.missingFromTestPlanTestCaseIds = requestedTestCaseIds.filter((id) => !sourceTestCaseIds.has(id))
    if (result.missingFromTestPlanTestCaseIds.length > 0) {
      result.reason = 'Every requested test case must be directly assigned to the specified test plan.'
      return result
    }

    result.canUnlink = true
    if (dryRun) return result

    const unassigned = await this.del<unknown>({
      pathParam: ['testPlans', testPlanId, 'testCases'],
      // This is the exact endpoint documented by Targetprocess.
      param: { childrenIds: requestedTestCaseIds.join(',') },
    })
    if (!unassigned.ok) {
      result.httpStatus = unassigned.status
      result.responseBody = unassigned.body
      result.retainedInTestPlanTestCaseIds = requestedTestCaseIds
      result.reason = `Targetprocess could not remove the selected links from test plan ${testPlanId}.`
      return result
    }

    for (const testCaseId of requestedTestCaseIds) {
      const planIds = await this.getTestCasePlanIds(testCaseId)
      if (!planIds) {
        result.unverifiedTestCaseIds.push(testCaseId)
      } else if (planIds.has(testPlanId)) {
        result.retainedInTestPlanTestCaseIds.push(testCaseId)
      } else {
        result.unlinkedTestCaseIds.push(testCaseId)
      }
    }

    if (result.retainedInTestPlanTestCaseIds.length > 0 || result.unverifiedTestCaseIds.length > 0) {
      result.reason = 'Targetprocess returned success, but not every removed link could be verified.'
    }
    return result
  }

  async batchMoveTestCasesToSubPlan({
    sourceTestPlanId,
    destinationTestPlanId,
    testCaseIds,
    batchSize = 100,
    dryRun = true,
  }: {
    sourceTestPlanId: string
    destinationTestPlanId: string
    testCaseIds: string[]
    batchSize?: number
    dryRun?: boolean
  }): Promise<TestCaseBatchMoveResult> {
    const requestedTestCaseIds = [...new Set(testCaseIds.map(String))]
    const result: TestCaseBatchMoveResult = {
      dryRun,
      sourceTestPlanId,
      destinationTestPlanId,
      batchSize,
      requestedTestCaseIds,
      movedTestCaseIds: [],
      unprocessedTestCaseIds: [],
      batches: [],
      canMove: false,
    }

    if (requestedTestCaseIds.length !== testCaseIds.length) {
      result.reason = 'Provide each test case ID only once.'
      return result
    }
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
      result.reason = 'batchSize must be an integer from 1 through 100.'
      return result
    }

    result.canMove = true
    for (let index = 0; index < requestedTestCaseIds.length; index += batchSize) {
      const batchIds = requestedTestCaseIds.slice(index, index + batchSize)
      const batch = await this.moveTestCasesToSubPlan({
        sourceTestPlanId,
        destinationTestPlanId,
        testCaseIds: batchIds,
        dryRun,
      })
      result.batches.push(batch)
      result.movedTestCaseIds.push(...batch.movedTestCaseIds)

      const completed = dryRun
        ? batch.canMove
        : batch.movedTestCaseIds.length === batchIds.length
      if (!completed) {
        result.canMove = false
        result.unprocessedTestCaseIds = requestedTestCaseIds.slice(index + batchIds.length)
        result.reason = `Stopped after batch ${result.batches.length}: ${batch.reason || 'the batch did not complete a verified move'}`
        return result
      }
    }
    return result
  }

  private async getTestCasePlanIds(testCaseId: string): Promise<Set<string> | null> {
    const testPlans = await this.getTestCaseTestPlans(testCaseId)
    return testPlans ? new Set(testPlans.map((testPlan) => testPlan.id)) : null
  }

  private async getDirectTestPlanTestCaseItems(testPlan: TestPlanNode): Promise<TestCase[] | null> {
    const items = await this.getAllOrNull<TestCase>({
      pathParam: ["testPlans", testPlan.id, "testcases"],
      param: { "format": "json" },
    })

    if (!items) return null

    return items.map((item) => ({
      ...item,
      TestPlanId: testPlan.numericId,
      TestPlanName: testPlan.name || item.LinkedTestPlan?.Name,
    }))
  }

  private async isTestPlanDescendant(ancestorTestPlanId: string, candidateTestPlanId: string): Promise<boolean | null> {
    const queue = [ancestorTestPlanId]
    const visited = new Set<string>()

    while (queue.length > 0) {
      const parentTestPlanId = queue.shift()!
      if (visited.has(parentTestPlanId)) continue
      visited.add(parentTestPlanId)

      const children = await this.getChildTestPlanNodes(parentTestPlanId)
      if (!children) return null

      for (const child of children) {
        if (child.id === candidateTestPlanId) return true
        if (!visited.has(child.id)) queue.push(child.id)
      }
    }

    return false
  }

  private async getChildTestPlanNodes(testPlanId: string): Promise<TestPlanNode[] | null> {
    const items = await this.getAllOrNull<Partial<TestPlan>>({
      pathParam: ["testPlans"],
      param: {
        "format": "json",
        "where": `ParentTestPlans.Id eq ${testPlanId}`,
        "include": "[Id,Name,ParentTestPlans[Id,Name]]",
      },
    })

    if (!items) return null

    return items
      .map((item) => this.toTestPlanNode(item))
      .filter((item): item is TestPlanNode => Boolean(item))
  }

  private toTestPlanNode(testPlan: Partial<TestPlan> | null, fallbackId?: string): TestPlanNode | null {
    const id = testPlan?.Id ?? fallbackId
    if (id === undefined || id === null) return null

    const numericId = Number(id)

    return {
      id: String(id),
      numericId: Number.isNaN(numericId) ? 0 : numericId,
      name: testPlan?.Name,
    }
  }

  async getTestCase<T>(testCaseId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["testCases", testCaseId],
      param: { "format": "json" },
    }) as T
  }

  async getTestCaseSteps<T>(testCaseId: string): Promise<T> {
    return { Next: '', Items: await this.apiAll<TestStep>(['testCases', testCaseId, 'teststeps'], { orderby: 'RunOrder' }) } as T
  }

  async updateTestCase<T>({ id, name, description, tags, addTags, removeTags }: { id: string, name?: string, description?: string, tags?: string, addTags?: string, removeTags?: string }): Promise<T> {
    const testCase: Record<string, any> = { "Id": id }

    if (name !== undefined) testCase["Name"] = name
    if (description !== undefined) testCase["Description"] = description
    const resolvedTags = await this.resolveUpdatedTags("TestCase", id, { tags, addTags, removeTags })
    if (resolvedTags === null) return null as T
    if (resolvedTags !== undefined) testCase["Tags"] = resolvedTags

    return this.post<any, T>({
      pathParam: ["testCases"],
      param: { "format": "json" },
    }, testCase) as T
  }

  async getTestStep<T>(testStepId: string): Promise<T> {
    return this.get<T>({
      pathParam: ["testSteps", testStepId],
      param: { "format": "json" },
    }) as T
  }

  async updateTestStep<T>({ id, description, result }: { id: string, description?: string, result?: string }): Promise<T> {
    const testStep: Record<string, any> = { "Id": id }

    if (description !== undefined) testStep["Description"] = description
    if (result !== undefined) testStep["Result"] = result

    return this.post<any, T>({
      pathParam: ["testSteps"],
      param: { "format": "json" },
    }, testStep) as T
  }

  async deleteTestStep<T>(testStepId: string): Promise<TpResult<T>> {
    return this.del<T>({
      pathParam: ["testSteps", testStepId],
      param: { "format": "json" },
    })
  }

  async deleteCard<T>({ id, type }: { id: string, type: "Bug" | "UserStory" | "Feature" | "Epic" }): Promise<TpResult<T>> {
    const pathSegment: Record<typeof type, string> = {
      "Bug": "bugs",
      "UserStory": "userStories",
      "Feature": "features",
      "Epic": "Epics",
    }

    return this.del<T>({
      pathParam: [pathSegment[type], id],
      param: { "format": "json" },
    })
  }

  async getProjects<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Projects"],
      param: { "format": "json" },
    }) as T
  }

  async getProcessWorkflows<T>({ processId }: { processId?: string }): Promise<T> {
    return this.get<T>({
      pathParam: ["Process"],
      param: {
        "format": "json",
        "where": `id=(${processId})`,
        "select": `{Workflows}`
      },
      apiVersion: this.v2
    }) as T
  }

  async getUserStories<T>({ take = 100 }: { take?: number }): Promise<T> {
    return this.get<T>({
      pathParam: ["userStories"],
      param: {
        "format": "json",
        "take": take,
      },
      apiVersion: this.v2
    }) as T
  }

  async getProcesses<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Processes"],
      param: { "format": "json" },
    }) as T
  }

  async getTeamAssignments<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["TeamAssignments"],
      param: { "format": "json" },
    }) as T
  }

  async getTeams<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Teams"],
      param: { "format": "json" },
    }) as T
  }

  async getUserStoryWorkflows<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["workflow"],
      param: {
        "format": "json",
        "select": `{Id,Name,Process,EntityType,EntityStates.Select({Id,Name}) as EntityStates}`,
        "where": `(process.id=${await this.processId()} and entityType.name="userStory" and parentWorkflow=null)`,
        "take": "1",
      },
      apiVersion: this.v2
    }) as T
  }

  async getUserStoryWorkflowsWithSubStates<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["EntityState"],
      param: {
        "format": "json",
        "select": `{id,name,isInitial,isFinal,isDefaultFinal,isPlanned,workflow:{workflow.id,process:{workflow.process.id}},entityType:{entityType.name},subEntityStates:subEntityStates.Select({id,name,entityType:{entityType.name},isInitial,isFinal,isDefaultFinal,isPlanned})}`,
        "where": `(parentEntityState==null and workflow.process.id in [${await this.processId()}])`,
        "take": "1000",
      },
      apiVersion: this.v2
    }) as T
  }

  async getBugWorkflows<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["workflow"],
      param: {
        "format": "json",
        "select": `{Id,Name,Process,EntityType,EntityStates.Select({Id,Name}) as EntityStates}`,
        "where": `(process.id=${await this.processId()} and entityType.name="bug" and parentWorkflow=null)`,
        "take": "1",
      },
      apiVersion: this.v2
    }) as T
  }

  async getCardStatus<T>(cardId: string, resourceType: 'UserStory' | 'Bug' | 'Feature' = 'UserStory'): Promise<T> {
    const pathMap = { UserStory: 'userStory', Bug: 'bug', Feature: 'feature' }
    return this.get<T>({
      pathParam: [pathMap[resourceType]],
      param: {
        "select": `{Project:{Project.Id},EntityState:{EntityState.Id,EntityState.Name,EntityState.NextStates,EntityState.Workflow.Id as WorkflowId},TeamState:{ResponsibleTeam.Id,Team:{ResponsibleTeam.Team.Id,ResponsibleTeam.Team.Name},EntityState:{ResponsibleTeam.EntityState.Id,ResponsibleTeam.EntityState.Name,ResponsibleTeam.EntityState.Workflow.Id as WorkflowId}},AssignedTeams.Select({TeamAssignmentId:Id,Id:Team.Id,Name:Team.Name}) as Teams}`,
        "where": `(id=${cardId})`,
        "take": "1",
      },
      apiVersion: this.v2
    }) as T
  }

  async getContext<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["Context"],
      param: { "format": "json" }
    }) as T
  }

  async getInProgressTasksAndBugs(userId: string): Promise<{ tasks: Task[], bugs: Bug[] }> {
    const where = `(EntityState.Name eq 'In Progress') and (AssignedUser.Id eq ${userId})`
    const include = "[Id,Name,EntityState[Name],UserStory[Id,Name,Feature[Id,Name]]]"
    const param = { "format": "json", "where": where, "include": include, "orderByDesc": "ModifyDate" }

    const [tasks, bugs] = await Promise.all([
      this.get<TpResponse<Task>>({ pathParam: ["Tasks"], param }),
      this.get<TpResponse<Bug>>({ pathParam: ["Bugs"], param }),
    ])

    return {
      tasks: tasks?.Items ?? [],
      bugs: bugs?.Items ?? [],
    }
  }

  async getTask<T>(taskId: string): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["Tasks", taskId],
      param: {
        "format": "json",
        "include": "[Id,Name,UserStory[Id,Name,Feature[Id,Name]]]",
      }
    }) as T

    return response
  }

  async getBugWithRelations<T>(bugId: string): Promise<T> {
    const response = await this.get<T>({
      pathParam: ["Bugs", bugId],
      param: {
        "format": "json",
        "include": "[Id,Name,UserStory[Id,Name,Feature[Id,Name]]]",
      }
    }) as T

    return response
  }

  async createTask<T>({ title, description, userStoryId }: { title: string, description?: string, userStoryId: string }): Promise<T> {
    const task: Record<string, any> = {
      "Name": title,
      "Project": {
        "Id": config.tp.projectId
      },
      "UserStory": {
        "Id": userStoryId
      },
    }

    if (description) {
      task["Description"] = description
    }

    return this.post<any, T>({
      pathParam: ["Tasks"],
      param: { "format": "json" },
    }, task) as T
  }

  async updateTask<T>({ id, title, description, entityStateId }: { id: string, title?: string, description?: string, entityStateId?: string }): Promise<T> {
    const task: Record<string, any> = { "Id": id }

    if (title !== undefined) task["Name"] = title
    if (description !== undefined) task["Description"] = description
    if (entityStateId !== undefined) task["EntityState"] = { "Id": entityStateId }

    return this.post<any, T>({
      pathParam: ["Tasks"],
      param: { "format": "json" },
    }, task) as T
  }

  async deleteTask<T>(taskId: string): Promise<TpResult<T>> {
    return this.del<T>({
      pathParam: ["Tasks", taskId],
      param: { "format": "json" },
    })
  }

  async logTime<T>({
    entityId,
    entityType,
    hours,
    description,
    date,
  }: {
    entityId: string
    entityType: 'Task' | 'UserStory' | 'Bug'
    hours: number
    description?: string
    date?: string
  }): Promise<T> {
    const timestamp = date ? new Date(date).getTime() : Date.now()
    const body: Record<string, any> = {
      Spent: hours,
      Date: `/Date(${timestamp})/`,
      User: { Id: config.tp.ownerId },
      Assignable: { Id: entityId, ResourceType: entityType },
    }
    if (description) body["Description"] = description

    return this.post<any, T>({
      pathParam: ["Times"],
      param: { "format": "json" },
    }, body) as T
  }

  async assignRole(cardId: string, userId: string, roleId: string): Promise<RoleAssignment | null> {
    return this.post<any, RoleAssignment>({
      pathParam: ["Assignments"],
      param: { "format": "json" },
    }, {
      Assignable: { Id: parseInt(cardId) },
      GeneralUser: { Id: parseInt(userId) },
      Role: { Id: parseInt(roleId) },
    })
  }

  async assignRoleToAllStoriesInFeature(featureId: string, userId: string, roleId: string): Promise<{ succeeded: RoleAssignment[]; failed: number[] }> {
    const storiesResponse = await this.getFeatureUserStories<{ items: { userStories: { items: { id: number; name: string }[] } }[] }>(featureId)
    const storyItems = storiesResponse?.items?.[0]?.userStories?.items ?? []
    const succeeded: RoleAssignment[] = []
    const failed: number[] = []
    await Promise.all(storyItems.map(async (story) => {
      const result = await this.assignRole(String(story.id), userId, roleId)
      if (result) {
        succeeded.push(result)
      } else {
        failed.push(story.id)
      }
    }))
    return { succeeded, failed }
  }

  async getAssignmentRoles<T>(): Promise<T | null> {
    return this.get<T>({
      pathParam: ["Roles"],
      param: { "format": "json" },
    })
  }

  async getMyTimeLogs<T>(take: number = 25): Promise<T> {
    return this.get<T>({
      pathParam: ["Times"],
      param: {
        "format": "json",
        "where": `User.Id eq ${config.tp.ownerId}`,
        "include": "[Id,Spent,Date,Description,Assignable[Id,Name,ResourceType]]",
        "orderByDesc": "Date",
        "take": take,
      },
    }) as T
  }

  async getMyUserStories<T>({ state, take = 25, skip = 0 }: { state?: string, take?: number, skip?: number }): Promise<T> {
    const whereParts = [`AssignedUser.Id eq ${config.tp.ownerId}`]
    if (state) whereParts.push(`EntityState.Name contains '${state}'`)

    return this.get<T>({
      pathParam: ["UserStories"],
      param: {
        "format": "json",
        "where": whereParts.join(' and '),
        "include": "[Id,Name,EntityState[Name],Effort,Project[Name],Feature[Id,Name],CreateDate,ModifyDate]",
        "orderByDesc": "ModifyDate",
        "take": take,
        "skip": skip,
      },
    }) as T
  }

  async getMyBugs<T>({ state, take = 25, skip = 0 }: { state?: string, take?: number, skip?: number }): Promise<T> {
    const whereParts = [`AssignedUser.Id eq ${config.tp.ownerId}`]
    if (state) whereParts.push(`EntityState.Name contains '${state}'`)

    return this.get<T>({
      pathParam: ["Bugs"],
      param: {
        "format": "json",
        "where": whereParts.join(' and '),
        "include": "[Id,Name,EntityState[Name],Severity[Name],Priority[Name],Project[Name],UserStory[Id,Name],CreateDate,ModifyDate]",
        "orderByDesc": "ModifyDate",
        "take": take,
        "skip": skip,
      },
    }) as T
  }

  // TP's Relations endpoint silently returns nothing for an OR across
  // Master.Id/Slave.Id, so we query each side separately and merge the results.
  async getCardRelations(cardId: string): Promise<TpResponse<Relation>> {
    const include = "[Id,RelationType[Name],Master[Id,Name,EntityType],Slave[Id,Name,EntityType]]"
    const query = (side: "Master" | "Slave") => this.get<TpResponse<Relation>>({
      pathParam: ["Relations"],
      param: {
        "format": "json",
        "where": `${side}.Id eq ${cardId}`,
        "include": include,
        "take": 100,
      },
    })

    const [asMaster, asSlave] = await Promise.all([query("Master"), query("Slave")])
    const items = [...(asMaster?.Items ?? []), ...(asSlave?.Items ?? [])]

    return { Next: "", Items: items }
  }

  async getRelationTypes<T>(): Promise<T> {
    return this.get<T>({
      pathParam: ["RelationTypes"],
      param: {
        "format": "json",
        "include": "[Id,Name]",
        "take": 100,
      },
    }) as T
  }

  // RelationType must be referenced by Id — passing it by Name makes TP try to
  // create a new RelationType resource, which returns 405 Method Not Allowed.
  async createRelation<T>({ masterId, slaveId, relationTypeId }: { masterId: string, slaveId: string, relationTypeId: string }): Promise<TpResult<T>> {
    const relation = {
      "Master": { "Id": masterId },
      "Slave": { "Id": slaveId },
      "RelationType": { "Id": relationTypeId },
    }

    return this.postRaw<any, T>({
      pathParam: ["Relations"],
      param: { "format": "json" },
    }, relation)
  }

  async deleteRelation<T>(relationId: string): Promise<TpResult<T>> {
    return this.del<T>({
      pathParam: ["Relations", relationId],
      param: { "format": "json" },
    })
  }


  // Compatibility with the connected upstream 2.6.10 server; preserve these tools when upgrading the older checkout.

  async moveTestCasesBetweenSiblingPlans({ parentTestPlanId, sourceTestPlanId, destinationTestPlanId, testCaseIds, dryRun = true }: { parentTestPlanId: string; sourceTestPlanId: string; destinationTestPlanId: string; testCaseIds: string[]; dryRun?: boolean }): Promise<CompatibleCaseMoveResult> {

    return this.moveCompatibleTestCases({ sourceTestPlanId, destinationTestPlanId, testCaseIds, dryRun }, { kind: 'sibling', parentTestPlanId })

  }



  private async readCasePlanIdsSafely(id: string): Promise<Set<string> | null> {

    try { return await this.getTestCasePlanIds(id) } catch { return null }

  }



  private async moveCompatibleTestCases({ sourceTestPlanId, destinationTestPlanId, testCaseIds, dryRun }: { sourceTestPlanId: string; destinationTestPlanId: string; testCaseIds: string[]; dryRun: boolean }, relation: { kind: 'sibling'; parentTestPlanId: string } | { kind: 'descendant' }): Promise<CompatibleCaseMoveResult> {
        const requestedTestCaseIds = [...new Set(testCaseIds.map(String))];
        const result: CompatibleCaseMoveResult = {
            dryRun,
            sourceTestPlanId,
            destinationTestPlanId,
            ...(relation.kind === 'sibling' ? { parentTestPlanId: relation.parentTestPlanId } : {}),
            requestedTestCaseIds,
            eligibleTestCaseIds: [],
            missingFromSourceTestCaseIds: [],
            alreadyInDestinationTestCaseIds: [],
            canMove: false,
            movedTestCaseIds: [],
            unprocessedTestCaseIds: [],
            failedToAssign: [],
            retainedInSourceTestCaseIds: [],
            restoredToSourceTestCaseIds: [],
            unassignedWithoutDestinationTestCaseIds: [],
            unverifiedMoveTestCaseIds: [],
        };
        if (sourceTestPlanId === destinationTestPlanId) {
            result.reason = 'Source and destination test plans must be different.';
            return result;
        }
        if (requestedTestCaseIds.length !== testCaseIds.length) {
            result.reason = 'Provide each test case ID only once.';
            return result;
        }
        if (requestedTestCaseIds.length === 0) {
            result.reason = 'Provide at least one test case ID.';
            return result;
        }
        const sourceTestCases = await this.getAllOrNull<TestCase>({
            pathParam: ["testPlans", sourceTestPlanId, "testcases"],
            param: { "format": "json" },
        });
        if (!sourceTestCases) {
            result.reason = `Unable to read direct test cases in source test plan ${sourceTestPlanId}.`;
            return result;
        }
        const sourceTestCaseIds = new Set(sourceTestCases.map((testCase) => String(testCase.Id)));
        result.eligibleTestCaseIds = requestedTestCaseIds.filter((id) => sourceTestCaseIds.has(id));
        result.missingFromSourceTestCaseIds = requestedTestCaseIds.filter((id) => !sourceTestCaseIds.has(id));
        if (result.missingFromSourceTestCaseIds.length > 0) {
            result.reason = 'Every requested test case must be directly assigned to the source test plan.';
            return result;
        }
        if (relation.kind === 'sibling') {
            const { parentTestPlanId } = relation;
            if (!/^\d+$/.test(parentTestPlanId) || parentTestPlanId === sourceTestPlanId || parentTestPlanId === destinationTestPlanId) {
                result.reason = 'Provide a different numeric shared parent test plan ID.';
                return result;
            }
            const parent = await this.getTestPlan<TestPlan>(parentTestPlanId);
            const children = parent ? await this.getChildTestPlanNodes(parentTestPlanId) : null;
            if (!parent || String(parent.Id) !== parentTestPlanId || !children) {
                result.reason = `Unable to verify the direct child plans of ${parentTestPlanId}.`;
                return result;
            }
            if (!children.some((plan) => plan.id === sourceTestPlanId)
                || !children.some((plan) => plan.id === destinationTestPlanId)) {
                result.reason = 'Source and destination must both be direct child plans of the specified parent.';
                return result;
            }
            const destinationTestCases = await this.getAllOrNull<TestCase>({
                pathParam: ['testPlans', destinationTestPlanId, 'testcases'],
                param: { format: 'json' },
            });
            if (!destinationTestCases) {
                result.reason = `Unable to read direct test cases in destination test plan ${destinationTestPlanId}.`;
                return result;
            }
            const destinationIds = new Set(destinationTestCases.map((testCase) => String(testCase.Id)));
            result.alreadyInDestinationTestCaseIds = requestedTestCaseIds.filter((id) => destinationIds.has(id));
            if (result.alreadyInDestinationTestCaseIds.length > 0) {
                result.reason = 'Selected test cases already linked to the destination must be resolved before moving.';
                return result;
            }
        }
        else {
            const isDescendant = await this.isTestPlanDescendant(sourceTestPlanId, destinationTestPlanId);
            if (isDescendant === null) {
                result.reason = `Unable to verify that test plan ${destinationTestPlanId} is nested below ${sourceTestPlanId}.`;
                return result;
            }
            if (!isDescendant) {
                result.reason = `Destination test plan ${destinationTestPlanId} is not a sub plan of ${sourceTestPlanId}.`;
                return result;
            }
        }
        result.canMove = true;
        if (dryRun)
            return result;
        // POST assignments are additive. Move one case at a time, never assigning
        // a destination until its own source link was removed and verified.
        for (const [index, testCaseId] of requestedTestCaseIds.entries()) {
            // Direct membership was checked during preflight; avoid listing every
            // source case again for each selected case.
            const unassigned = await this.removeTestCaseLinksFromPlan(sourceTestPlanId, [testCaseId]);
            if (!unassigned.ok) {
                result.retainedInSourceTestCaseIds.push(testCaseId);
                result.unprocessedTestCaseIds = requestedTestCaseIds.slice(index + 1);
                result.reason = `The source link to ${sourceTestPlanId} could not be removed for case ${testCaseId}; no destination link was added for it. No test cases were deleted or copied.`;
                return result;
            }
            const afterUnlink = await this.readCasePlanIdsSafely(testCaseId);
            if (!afterUnlink || afterUnlink.has(sourceTestPlanId)) {
                if (afterUnlink?.has(sourceTestPlanId)) {
                    result.retainedInSourceTestCaseIds.push(testCaseId);
                }
                else {
                    result.unverifiedMoveTestCaseIds.push(testCaseId);
                    const restored = await this.restoreTestCaseToPlan(testCaseId, sourceTestPlanId);
                    if (restored === 'restored')
                        result.restoredToSourceTestCaseIds.push(testCaseId);
                    else if (restored === 'unassigned')
                        result.unassignedWithoutDestinationTestCaseIds.push(testCaseId);
                }
                result.unprocessedTestCaseIds = requestedTestCaseIds.slice(index + 1);
                result.reason = `The source link to ${sourceTestPlanId} could not be verified as removed for case ${testCaseId}; no destination link was added for it. No test cases were deleted or copied.`;
                return result;
            }
            const assigned = await this.tryPost<unknown, unknown>({
                pathParam: ["testCases", testCaseId],
                param: { "format": "json" },
            }, {
                "TestPlans": { "Items": [{ "Id": destinationTestPlanId }] },
            });
            const planIds = await this.readCasePlanIdsSafely(testCaseId);
            if (planIds?.has(destinationTestPlanId) && !planIds.has(sourceTestPlanId)) {
                result.movedTestCaseIds.push(testCaseId);
                continue;
            }
            if (!assigned) {
                result.failedToAssign.push({ id: testCaseId, reason: `Could not assign to test plan ${destinationTestPlanId}.` });
                const restored = await this.restoreTestCaseToPlan(testCaseId, sourceTestPlanId);
                if (restored === 'restored')
                    result.restoredToSourceTestCaseIds.push(testCaseId);
                else if (restored === 'unassigned')
                    result.unassignedWithoutDestinationTestCaseIds.push(testCaseId);
                else
                    result.unverifiedMoveTestCaseIds.push(testCaseId);
                result.unprocessedTestCaseIds = requestedTestCaseIds.slice(index + 1);
                result.reason = 'Destination assignment failed; source-link restoration was attempted and verified where possible.';
                return result;
            }
            result.unverifiedMoveTestCaseIds.push(testCaseId);
            if (planIds && !planIds.has(destinationTestPlanId) && !planIds.has(sourceTestPlanId)) {
                const restored = await this.restoreTestCaseToPlan(testCaseId, sourceTestPlanId);
                if (restored === 'restored')
                    result.restoredToSourceTestCaseIds.push(testCaseId);
                else if (restored === 'unassigned')
                    result.unassignedWithoutDestinationTestCaseIds.push(testCaseId);
            }
            result.unprocessedTestCaseIds = requestedTestCaseIds.slice(index + 1);
            result.reason = 'Destination assignment could not be verified; stopped before moving further cases.';
            return result;
        }
        return result;
    }

  async unlinkChildTestPlanFromParent({ parentTestPlanId, childTestPlanId, dryRun = true }: { parentTestPlanId: string; childTestPlanId: string; dryRun?: boolean }): Promise<ChildPlanUnlinkResult> {
        const result: ChildPlanUnlinkResult = {
            dryRun, parentTestPlanId, childTestPlanId, canUnlink: false, unlinked: false,
            missingDirectTestCaseIdsAfter: [],
        };
        if (parentTestPlanId === childTestPlanId || !/^\d+$/.test(parentTestPlanId) || !/^\d+$/.test(childTestPlanId)) {
            result.reason = 'Provide different numeric parent and child test plan IDs.';
            return result;
        }
        const parent = await this.getTestPlan<TestPlan>(parentTestPlanId);
        const child = await this.getTestPlan<TestPlan>(childTestPlanId);
        if (!parent || !child || String(parent.Id) !== parentTestPlanId || String(child.Id) !== childTestPlanId) {
            result.reason = 'Unable to verify that both test plans exist.';
            return result;
        }
        const children = await this.getChildTestPlanNodes(parentTestPlanId);
        if (!children) {
            result.reason = `Unable to read direct child plans of ${parentTestPlanId}.`;
            return result;
        }
        if (!children.some((plan) => plan.id === childTestPlanId)) {
            result.reason = `Test plan ${childTestPlanId} is not directly linked beneath ${parentTestPlanId}.`;
            return result;
        }
        const before = await this.getAllOrNull<TestCase>({
            pathParam: ['testPlans', childTestPlanId, 'testcases'],
            param: { format: 'json' },
        });
        if (!before) {
            result.reason = `Unable to read direct test cases in ${childTestPlanId}.`;
            return result;
        }
        result.directTestCaseCountBefore = before.length;
        result.canUnlink = true;
        if (dryRun)
            return result;
        // Delete only the association collection entry, never /testPlans/{id}.
        const unassigned = await this.del<unknown>({
            pathParam: ['testPlans', parentTestPlanId, 'ChildTestPlans'],
            param: { childrenIds: childTestPlanId },
        });
        if (!unassigned.ok) {
            result.httpStatus = unassigned.status;
            result.responseBody = unassigned.body;
            result.reason = `Targetprocess could not unlink test plan ${childTestPlanId} from ${parentTestPlanId}.`;
            return result;
        }
        const remainingChildren = await this.getChildTestPlanNodes(parentTestPlanId);
        const remainingParent = await this.getTestPlan<TestPlan>(parentTestPlanId);
        const remainingChild = await this.getTestPlan<TestPlan>(childTestPlanId);
        const after = await this.getAllOrNull<TestCase>({
            pathParam: ['testPlans', childTestPlanId, 'testcases'],
            param: { format: 'json' },
        });
        if (!remainingChildren || !remainingParent || !remainingChild || !after) {
            result.reason = 'Targetprocess returned success, but plan and case preservation could not be verified.';
            return result;
        }
        const afterIds = new Set(after.map((testCase) => String(testCase.Id)));
        result.missingDirectTestCaseIdsAfter = before
            .map((testCase) => String(testCase.Id))
            .filter((id) => !afterIds.has(id));
        if (remainingChildren.some((plan) => plan.id === childTestPlanId)
            || String(remainingParent.Id) !== parentTestPlanId
            || String(remainingChild.Id) !== childTestPlanId
            || result.missingDirectTestCaseIdsAfter.length > 0) {
            result.reason = 'Targetprocess returned success, but the unlink or plan/case preservation could not be verified.';
            return result;
        }
        result.unlinked = true;
        return result;
    }

  private async removeTestCaseLinksFromPlan(testPlanId: string, testCaseIds: string[]): Promise<TpResult<unknown>> {
        return this.del<unknown>({
            pathParam: ['testPlans', testPlanId, 'testCases'],
            // This is the exact endpoint documented by Targetprocess.
            param: { childrenIds: testCaseIds.join(',') },
        });
    }

  private async restoreTestCaseToPlan(testCaseId: string, testPlanId: string): Promise<'restored' | 'unassigned' | 'unverified'> {
        await this.tryPost<unknown, unknown>({
            pathParam: ['testCases', testCaseId],
            param: { format: 'json' },
        }, {
            TestPlans: { Items: [{ Id: testPlanId }] },
        });
        const planIds = await this.readCasePlanIdsSafely(testCaseId);
        if (!planIds)
            return 'unverified';
        return planIds.has(testPlanId) ? 'restored' : 'unassigned';
    }

  async addAttachedFile(generalId: string, source: { filePath: string } | { fileContent: string; fileName: string }): Promise<string> {
    const fileName = 'filePath' in source ? basename(source.filePath) : source.fileName
    const blob = new Blob(['filePath' in source ? readFileSync(source.filePath) : Buffer.from(source.fileContent, 'base64')])
    const form = new FormData()
    form.append('generalId', generalId)
    form.append('file', blob, fileName)
    return this.http.request<string>('POST', '/UploadFile.ashx', {}, form, true)
  }
}
