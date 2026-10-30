import type { TpClient } from './tp.js'
import { assertId } from './test_management.js'
import { fields, equivalentMarkup, safeMetadata } from './capability_helpers.js'
import { TpApiError, errorDetails } from './http.js'

type Row = Record<string, any>
export const cardResources = ['UserStories', 'Bugs', 'Features', 'Epics', 'Tasks', 'Requests', 'TestPlans', 'TestPlanRuns'] as const
export type CardResource = typeof cardResources[number]
export const historyTypes = ['UserStory', 'Bug', 'Feature', 'Epic', 'Task', 'Request'] as const
export type HistoryType = typeof historyTypes[number]
export type HistoryOptions = { entityTypes: HistoryType[]; entityIds?: string[]; projectId?: string; from: string; to: string; take: number; skip: number; direction: 'asc' | 'desc'; timezoneOffset?: string; stateName?: string; statusScope?: 'EntityState' | 'TeamState' }
const quote = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
export function timestamp(value: string, offset?: string) {
  const ms = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value)
  if (ms) return new Date(Number(ms[1])).toISOString()
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(value)) {
    if (!offset || !/^[+-](?:0\d|1[0-4]):[0-5]\d$/.test(offset)) throw new Error('History timestamp has no timezone; supply the verified tenant timezoneOffset or TP_HISTORY_TIMEZONE_OFFSET')
    value += offset
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid history timestamp')
  return date.toISOString()
}
export class Insights {
  private readonly schemas = new Map<string, ReturnType<typeof fields>>()
  constructor(readonly tp: TpClient) {}
  private async schema(resource: string) {
    if (!this.schemas.has(resource)) this.schemas.set(resource, fields(await this.tp.api('GET', [resource, 'meta'])))
    return this.schemas.get(resource)!
  }
  async directory(resource: string, options: { keyword?: string; id?: string; projectId?: string; take?: number; skip?: number; all?: boolean; active?: boolean }) {
    const meta = await this.schema(resource)
    const where: string[] = []
    if (options.id) where.push('Id eq ' + assertId(options.id))
    if (options.keyword) {
      const field = resource === 'Users' && meta.has('FullName') ? 'FullName' : 'Name'
      if (!meta.has(field)) throw new Error('Search field is unavailable on ' + resource)
      where.push(field + " contains '" + quote(options.keyword) + "'")
    }
    if (options.projectId) {
      if (!meta.has('Project')) throw new Error('Project filtering is unavailable for ' + resource)
      where.push('Project.Id eq ' + assertId(options.projectId))
    }
    if (options.active !== undefined) {
      if (!meta.has('IsActive')) throw new Error('IsActive filtering is unavailable for ' + resource)
      where.push("IsActive eq '" + options.active + "'")
    }
    const query = { ...(where.length ? { where: where.join(' and ') } : {}), orderBy: 'Id' }
    if (options.all) {
      const items = await this.tp.apiAll<Row>([resource], query)
      return { resource, items: safeMetadata(items), complete: true, returned: items.length, next: null }
    }
    const page = await this.tp.api<{ Items: Row[]; Next?: string }>('GET', [resource], undefined, { ...query, take: options.take ?? 100, skip: options.skip ?? 0 })
    if (!Array.isArray(page?.Items)) throw new Error('Invalid ' + resource + ' response; completeness cannot be established')
    return { resource, items: safeMetadata(page.Items), complete: !page.Next && !options.skip, pageComplete: true, hasMore: Boolean(page.Next), nextSkip: page.Next ? (options.skip ?? 0) + page.Items.length : null, returned: page.Items.length }
  }
  async details(resource: CardResource, id: string): Promise<Row> {
    const meta = await this.schema(resource)
    const expansions = ['Id', 'Name', 'Description', 'Owner', 'Creator', 'Project', 'EntityState', 'ResponsibleTeam', 'Units', 'CustomFields'].filter(n => meta.has(n))
    for (const n of ['Iteration', 'TeamIteration']) if (meta.has(n)) expansions.push(n + '[Id,Name,StartDate,EndDate' + (n === 'TeamIteration' ? ',Team[Id,Name]' : '') + ']')
    const card = await this.tp.api<Row>('GET', [resource, assertId(id)], undefined, { include: '[' + expansions.join(',') + ']' })
    if (String(card?.Id) !== id) throw new Error('Card identity could not be verified')
    const collections: Row = {}
    for (const name of ['Assignments', 'RoleEfforts', 'AssignedEfforts', 'AssignedTeams']) {
      collections[name] = meta.has(name) ? { availability: 'available', items: await this.tp.apiAll<Row>([resource, id, name]) } : { availability: 'unavailable', items: null }
    }
    return safeMetadata({ ...card, ...collections, iterationConcepts: { Iteration: 'project iteration', TeamIteration: 'team sprint' } })
  }
  async workflow(resource: CardResource, id: string) {
    const card = await this.tp.api<Row>('GET', [resource, assertId(id)], undefined, { include: '[Id,Name,Project,EntityState[Id,Name,Workflow],ResponsibleTeam]' })
    if (String(card?.Id) !== id || !card.Project?.Id || !card.EntityState?.Workflow?.Id) throw new Error('Actual card project/workflow cannot be resolved')
    const project = await this.tp.api<Row>('GET', ['Projects', String(card.Project.Id)])
    if (!project.Process?.Id) throw new Error('Card process cannot be resolved')
    const states = await this.tp.apiAll<Row>(['EntityStates'], { where: 'Workflow.Id eq ' + card.EntityState.Workflow.Id + ' and Workflow.Process.Id eq ' + project.Process.Id, include: '[Id,Name,IsInitial,IsFinal,Workflow,EntityType]' })
    return { cardId: id, project: card.Project, process: project.Process, workflow: card.EntityState.Workflow, currentState: card.EntityState, responsibleTeam: card.ResponsibleTeam, states, complete: true }
  }
  async workload(options: { entityTypes: CardResource[]; roleId: string; estimateField?: 'Effort' | 'InitialEstimate'; testerId?: string; projectId?: string; teamId?: string; iterationId?: string; teamIterationId?: string; missingOnly?: boolean }) {
    if (options.teamId) assertId(options.teamId)
    if (options.testerId) assertId(options.testerId)
    const role = await this.tp.api<Row>('GET', ['Roles', assertId(options.roleId)])
    if (String(role?.Id) !== options.roleId) throw new Error('Role identity could not be verified')
    const estimateField = options.estimateField ?? 'Effort'
    const cards: Row[] = [], groups = new Map<string, Row>()
    for (const resource of options.entityTypes) {
      const meta = await this.schema(resource)
      const where: string[] = []
      for (const [key, field] of [['projectId', 'Project'], ['iterationId', 'Iteration'], ['teamIterationId', 'TeamIteration']] as const) {
        if (options[key]) {
          if (!meta.has(field)) throw new Error(field + ' is unavailable on ' + resource)
          where.push(field + '.Id eq ' + assertId(options[key]!))
        }
      }
      if (options.testerId) where.push('Assignments.GeneralUser.Id eq ' + options.testerId)
      if (options.teamId) where.push('AssignedTeams.Team.Id eq ' + options.teamId)
      if (meta.has('Assignments')) where.push('Assignments.Role.Id eq ' + options.roleId)
      const summaries = await this.tp.apiAll<Row>([resource], { ...(where.length ? { where: where.join(' and ') } : {}), include: '[Id,Name]' })
      for (const summary of summaries) {
        const card = await this.details(resource, String(summary.Id))
        if (options.teamId && !card.AssignedTeams.items?.some((a: Row) => String(a.Team?.Id) === options.teamId)) continue
        if (card.Assignments.availability !== 'available') throw new Error('Assignments are unavailable on ' + resource + '; workload cannot be established')
        const assigned = card.Assignments.items.filter((a: Row) => String(a.Role?.Id) === options.roleId)
        const testerIds = [...new Set<string>(assigned.map((a: Row) => String(a.GeneralUser?.Id)).filter((v: string) => /^[1-9]\d*$/.test(v)))]
        if (options.testerId && !testerIds.includes(options.testerId)) continue
        const estimates = card.RoleEfforts.items?.filter((e: Row) => String(e.Role?.Id) === options.roleId)
        const state = card.RoleEfforts.availability !== 'available' ? 'unavailable' : !estimates?.length ? 'unset' : estimates.some((e: Row) => e[estimateField] === undefined) ? 'unavailable' : estimates.some((e: Row) => e[estimateField] === null) ? 'unset' : estimates.some((e: Row) => typeof e[estimateField] !== 'number') ? 'unavailable' : 'set'
        const estimate = state === 'set' ? estimates.reduce((n: number, e: Row) => n + e[estimateField], 0) : null
        if (options.missingOnly && state !== 'unset') continue
        const item = { id: card.Id, name: card.Name, entityType: resource, owner: card.Owner, assignments: assigned, iteration: card.Iteration, teamIteration: card.TeamIteration, units: card.Units ?? null, qaEstimate: { state, value: estimate, field: 'RoleEfforts.' + estimateField, role, records: estimates ?? null }, assignedEfforts: card.AssignedEfforts, sharedRoleEstimate: testerIds.length > 1 }
        cards.push(item)
        for (const testerId of testerIds) {
          if (options.testerId && options.testerId !== testerId) continue
          const key = [testerId, card.TeamIteration?.Id ?? '', card.Iteration?.Id ?? '', card.Units ?? 'unknown'].join(':')
          const group = groups.get(key) ?? { tester: assigned.find((a: Row) => String(a.GeneralUser?.Id) === testerId)?.GeneralUser, teamIteration: card.TeamIteration ?? null, iteration: card.Iteration ?? null, units: card.Units ?? null, exclusiveEstimate: 0, sharedUnallocatedEstimate: 0, missing: [], unavailable: [], cards: [] }
          if (state === 'set') group[testerIds.length === 1 ? 'exclusiveEstimate' : 'sharedUnallocatedEstimate'] += estimate
          else group[state === 'unset' ? 'missing' : 'unavailable'].push(card.Id)
          group.cards.push(card.Id); groups.set(key, group)
        }
      }
    }
    return { complete: true, role, cards, totals: [...groups.values()], allocation: 'Role effort is counted once per card. Shared role estimates are unallocated; totals must not be summed across testers. No development effort is used.' }
  }
  async historyRecords(type: HistoryType, from: string, to: string, take: number, skip: number) {
    const resource = type + 'Histories'
    const meta = await this.schema(resource)
    const include = ['Id', 'Date', 'DateTo', 'Modification', 'SourceEntityId', 'Changes', 'ExtendedState', 'EventId', 'Modifier', 'EntityState', 'TeamState', 'PreviousHistoryRecord', 'Current' + type].filter(name => meta.has(name))
    const page = await this.tp.api<{ Items: Row[]; Next?: string }>('GET', [resource], undefined, { where: "Date gte '" + quote(from) + "' and Date lt '" + quote(to) + "'", include: '[' + include.join(',') + ']', take, skip, orderByDesc: 'Date' })
    if (!Array.isArray(page.Items)) throw new Error('Invalid history response')
    const items = page.Items.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, typeof value === 'string' && value.length > 8000 ? value.slice(0, 8000) + '[truncated]' : value])))
    return { items, hasMore: Boolean(page.Next), nextSkip: page.Next ? skip + page.Items.length : null, complete: !page.Next && !skip, untrustedContent: true }
  }
  async history(options: HistoryOptions, kind: 'status' | 'tags') {
    if (Date.parse(options.from) >= Date.parse(options.to)) throw new Error('from must precede to; range is [from,to)')
    const events: Row[] = [], limitations: Row[] = [], teamStateSupport: Row[] = []
    let allEventsLoaded = true
    const needed = options.skip + options.take + 1
    for (const type of [...new Set(options.entityTypes)]) {
      const resource = type + 'Histories'
      const meta = await this.schema(resource)
      const field = kind === 'status' ? options.statusScope ?? 'EntityState' : 'Tags'
      teamStateSupport.push({ entityType: type, available: meta.has('TeamState') && meta.has('IsChangedTeamState') })
      if (!meta.has(field) || !meta.has('IsChanged' + field)) {
        limitations.push({ entityType: type, available: false, reason: kind === 'tags' ? 'Targetprocess history does not expose tag changes; current Tags cannot establish additions/removals or correlate them with state changes.' : field + ' history is unavailable.' })
        continue
      }
      const current = meta.has('Current' + type) ? 'Current' + type : undefined
      if (!current) throw new Error(resource + ' does not expose the documented current-entity reference')
      const where = ["Date gte '" + quote(options.from) + "'", "Date lt '" + quote(options.to) + "'", 'IsChanged' + field + " eq 'true'"]
      if (options.projectId) where.push('Project.Id eq ' + assertId(options.projectId))
      if (options.entityIds?.length) where.push('(' + options.entityIds.map(id => current + '.Id eq ' + assertId(id)).join(' or ') + ')')
      if (kind === 'status' && options.stateName) where.push(field + ".Name eq '" + quote(options.stateName) + "'")
      const include = ['Id', 'Name', 'Date', 'DateTo', 'Modification', field, current, 'Modifier', 'Project', 'Team', 'WorkflowTeam', 'EventId', 'SourceEntityId'].filter(n => meta.has(n))
      if (meta.has('PreviousHistoryRecord')) include.push('PreviousHistoryRecord[Id,' + field + ']')
      type Page = { Items: Row[]; Next?: string }
      let page = await this.tp.api<Page>('GET', [resource], undefined, { where: where.join(' and '), [options.direction === 'desc' ? 'orderByDesc' : 'orderBy']: 'Date', take: Math.min(100, needed), include: '[' + include.join(',') + ']' })
      const typeEvents: Row[] = [], seen = new Set<string>()
      let exhausted = false
      for (let count = 0; count < 10000; count++) {
        if (!Array.isArray(page?.Items)) throw new Error('Invalid history collection')
        for (const row of page.Items) {
          let previous = row.PreviousHistoryRecord
          if (previous?.Id && !(field in previous)) previous = await this.tp.api<Row>('GET', [resource, String(previous.Id)])
          if (!previous && row.Modification !== 'Add') {
            const before = await this.tp.api<Page>('GET', [resource], undefined, { where: current + '.Id eq ' + assertId(String(row[current]?.Id ?? row.SourceEntityId)) + " and Date lt '" + quote(timestamp(row.Date, options.timezoneOffset ?? process.env.TP_HISTORY_TIMEZONE_OFFSET)) + "'", orderByDesc: 'Date', take: 1, include: '[Id,' + field + ']' })
            previous = before.Items?.[0]
          }
          if (!previous && row.Modification === 'Add') continue
          if (!previous) limitations.push({ historyId: row.Id, reason: 'Previous historical state is unavailable; transition origin cannot be verified' })
          const date = timestamp(row.Date, options.timezoneOffset ?? process.env.TP_HISTORY_TIMEZONE_OFFSET)
          const event: Row = { historyId: row.Id, eventId: row.EventId ?? null, entityId: row[current]?.Id ?? row.SourceEntityId, entityType: type, title: row.Name ?? row[current]?.Name, timestamp: date, rawTimestamp: row.Date, actor: row.Modifier ?? null, project: row.Project ?? null, team: row.WorkflowTeam ?? row.Team ?? null, scope: field, previousKnown: Boolean(previous), historyWindowEnd: row.DateTo ?? null }
          if (kind === 'status') {
            event.previous = previous?.[field] ?? null; event.next = row[field]
            if (previous?.[field]?.Id === row[field]?.Id) continue
            if (options.stateName && event.next?.Name !== options.stateName) continue
          } else {
            if (!previous) continue
            const split = (v: unknown) => typeof v === 'string' ? v.split(',').map(t => t.trim()).filter(Boolean) : []
            const old = split(previous.Tags), next = split(row.Tags)
            event.added = next.filter(t => !old.includes(t)); event.removed = old.filter(t => !next.includes(t))
          }
          typeEvents.push(event)
        }
        if (!page.Next) { exhausted = true; break }
        if (typeEvents.length >= needed) break
        if (!page.Items.length || seen.has(page.Next)) throw new Error('History pagination failed to advance')
        seen.add(page.Next); page = await this.tp.apiPage<Page>(page.Next)
      }
      if (!exhausted) allEventsLoaded = false
      events.push(...typeEvents)
    }
    events.sort((a, b) => (a.timestamp.localeCompare(b.timestamp) || a.entityType.localeCompare(b.entityType) || a.historyId - b.historyId) * (options.direction === 'asc' ? 1 : -1))
    const hasMore = !allEventsLoaded || options.skip + options.take < events.length
    return { events: events.slice(options.skip, options.skip + options.take), returned: Math.max(0, Math.min(options.take, events.length - options.skip)), total: allEventsLoaded ? events.length : null, hasMore, nextSkip: hasMore ? options.skip + options.take : null, complete: !limitations.length, allEventsLoaded, limitations, timestampSemantics: 'UTC; naive API dates require an explicitly verified timezone offset. Non-state updates can be coalesced within five minutes; equal snapshot timestamps do not prove simultaneous actions.', teamStateHistory: teamStateSupport }
  }
  async comment(id: string, entityId: string, description?: string, remove = false) {
    const path = ['Comments', assertId(id)]
    const before = await this.tp.api<Row>('GET', path)
    if (String(before?.General?.Id) !== assertId(entityId)) throw new Error('Comment belongs to another entity')
    const meta = await this.tp.api<Row>('GET', ['Comments', 'meta'])
    if (remove ? meta.CanDelete !== true : meta.CanUpdate !== true || fields(meta).get('Description')?.CanSet !== true) throw new Error('Comment operation is unsupported by metadata')
    let writeError: unknown
    try { await this.tp.api(remove ? 'DELETE' : 'POST', path, remove ? undefined : { Description: description }) } catch (e) { writeError = e }
    try {
      const after = await this.tp.api<Row>('GET', path)
      if (remove || String(after.General?.Id) !== entityId || !equivalentMarkup(after.Description, description)) throw new Error('Comment change could not be verified')
      return { id, entityId, verified: true, comment: after }
    } catch (e) {
      if (remove && e instanceof TpApiError && e.status === 404) return { id, entityId, deleted: true, verified: true }
      return { id, entityId, status: 'partial', verified: false, writeStatus: writeError ? 'unknown' : 'acknowledged', error: errorDetails(e), recovery: 'Read this explicit comment ID before retrying.' }
    }
  }
}
