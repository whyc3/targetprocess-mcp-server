export async function handleCreateUserStory(tp, params) {
    const response = await tp.createUserStory(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to create user story "${params.title}"\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
