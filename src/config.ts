import 'dotenv/config'

export const config = {
  tp: {
    url: process.env.TP_BASE_URL || '',
    token: process.env.TP_TOKEN || '',
    ownerId: process.env.TP_OWNER_ID || '',
    projectId: process.env.TP_PROJECT_ID || '',
    teamId: process.env.TP_TEAM_ID || '',
    bugOriginField: process.env.TP_BUG_ORIGIN_FIELD || '',
    processId: process.env.TP_PROCESS_ID || '',
    userStoryWorkflowId: process.env.TP_USER_STORY_WORKFLOW_ID || '',
    bugWorkflowId: process.env.TP_BUG_WORKFLOW_ID || '',
    timeoutMs: Number(process.env.TP_REQUEST_TIMEOUT_MS || 30000),
    readRetries: Number(process.env.TP_READ_RETRIES || 2),
    debug: process.env.TP_DEBUG === 'true',
  },
}

export function validateConfiguration() {
  let url: URL
  try { url = new URL(config.tp.url) } catch { throw new Error('TP_BASE_URL must be an absolute HTTP(S) URL') }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('TP_BASE_URL must be an HTTP(S) URL without credentials, query, or fragment')
  }
  if (!config.tp.token.trim()) throw new Error('TP_TOKEN is required')
  for (const [key, value] of Object.entries({
    TP_OWNER_ID: config.tp.ownerId, TP_PROJECT_ID: config.tp.projectId,
    TP_TEAM_ID: config.tp.teamId, TP_PROCESS_ID: config.tp.processId,
  })) {
    if (value && !/^[1-9]\d*$/.test(value)) throw new Error(key + ' must be a positive integer ID')
  }
  if (!Number.isInteger(config.tp.timeoutMs) || config.tp.timeoutMs < 1 || config.tp.timeoutMs > 300000) {
    throw new Error('TP_REQUEST_TIMEOUT_MS must be an integer between 1 and 300000')
  }
  if (!Number.isInteger(config.tp.readRetries) || config.tp.readRetries < 0 || config.tp.readRetries > 5) {
    throw new Error('TP_READ_RETRIES must be an integer between 0 and 5')
  }
}
