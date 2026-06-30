export async function handleUpdateUserStorySubState(tp, params) {
    const response = await tp.updateUserStorySubState(params);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to update user story sub state id: ${params.id}\n JSON: ${JSON.stringify(response, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(response) }],
    };
}
