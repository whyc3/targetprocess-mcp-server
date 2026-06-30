export async function handleGetUserStoryBugs(tp, id) {
    const response = await tp.getUserStoryBugs(id);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get bugs for user story id: ${id}`
                }],
        };
    }
    const items = response.items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No bugs found for user story id: ${id}`,
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(items) }],
    };
}
