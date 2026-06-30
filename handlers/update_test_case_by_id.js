export async function handleUpdateTestCaseById(tp, params) {
    if (params.name === undefined && params.description === undefined) {
        return {
            content: [{
                    type: 'text',
                    text: `Nothing to update for test case id: ${params.id}`
                }],
        };
    }
    const testCaseResponse = await tp.updateTestCase(params);
    if (!testCaseResponse) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to update test case id: ${params.id}\n JSON: ${JSON.stringify(testCaseResponse, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(testCaseResponse) }],
    };
}
