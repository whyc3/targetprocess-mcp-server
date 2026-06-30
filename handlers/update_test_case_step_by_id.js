export async function handleUpdateTestCaseStepById(tp, params) {
    if (params.description === undefined && params.result === undefined) {
        return {
            content: [{
                    type: 'text',
                    text: `Nothing to update for test step id: ${params.id}`
                }],
        };
    }
    const existingTestStep = await tp.getTestStep(params.id);
    if (!existingTestStep) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get test step id: ${params.id}\n JSON: ${JSON.stringify(existingTestStep, null, 2)}`
                }],
        };
    }
    const testStepResponse = await tp.updateTestStep({
        id: params.id,
        description: params.description ?? existingTestStep.Description,
        result: params.result ?? existingTestStep.Result,
    });
    if (!testStepResponse) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to update test step id: ${params.id}\n JSON: ${JSON.stringify(testStepResponse, null, 2)}`
                }],
        };
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(testStepResponse) }],
    };
}
