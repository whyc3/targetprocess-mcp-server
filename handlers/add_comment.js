export async function handleAddComment(tp, id, comment) {
    const response = await tp.addComment(id, comment);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to add comment to user story, id: ${id}\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
