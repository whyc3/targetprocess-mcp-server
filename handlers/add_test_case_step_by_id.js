export async function handleAddTestCaseStepById(tp, params) {
    const testStepResponse = await tp.addTestStep(params.testCaseId, {
        description: params.description,
        result: params.result,
    });
    if (!testStepResponse) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to add test step to test case id: ${params.testCaseId}\n JSON: ${JSON.stringify(testStepResponse, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(testStepResponse) }],
    };
}
