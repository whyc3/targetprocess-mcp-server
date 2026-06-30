export async function handleGetTeams(tp) {
    const response = await tp.getTeams();
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get teams, JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No teams found' }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items.map((t) => ({ id: t.Id, name: t.Name }))) }],
    };
}
export async function handleGetTeamsAndTeamAssignments(tp) {
    const teams = await tp.getTeams();
    const teamAssignments = await tp.getTeamAssignments();
    if (!teams || !teamAssignments) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get teams and team assignments, JSON: ${JSON.stringify({ teams, teamAssignments }, null, 2)}`
                }],
        };
    }
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({
                    teams: teams.Items.map((t) => ({ id: t.Id, name: t.Name })),
                    teamAssignments: teamAssignments.Items.map((t) => ({ id: t.Id, name: t.Team.Name })),
                }),
            }],
    };
}
