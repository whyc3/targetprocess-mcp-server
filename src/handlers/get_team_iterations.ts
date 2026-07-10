import type { TpClient } from '../tp.js'
import type * as TP from '../types.js'

export async function handleGetTeamIterations(tp: TpClient, params: { teamId?: string }) {
  const response = await tp.getTeamIterations<TP.TpResponse<TP.TeamIteration>>(params)

  if (!response) {
    return {
      content: [{
        type: 'text' as const,
        text: `Failed to get team iterations, JSON: ${JSON.stringify(response, null, 2)}`
      }],
    }
  }

  const items = response.Items || []
  if (items.length === 0) {
    return {
      content: [{ type: 'text' as const, text: 'No team iterations found' }],
    }
  }

  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(items.map((i) => ({
        id: i.Id,
        name: i.Name,
        startDate: i.StartDate,
        endDate: i.EndDate,
        teamId: i.Team?.Id,
        teamName: i.Team?.Name,
      }))),
    }],
  }
}
