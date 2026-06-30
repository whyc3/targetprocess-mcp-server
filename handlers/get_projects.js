export async function handleGetProjects(tp) {
    const response = await tp.getProjects();
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get projects, JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{ type: 'text', text: 'No projects found' }],
        };
    }
    return {
        content: [{
                type: 'text',
                text: JSON.stringify(items.map((p) => ({ id: p.Id, name: p.Name })))
            }],
    };
}
