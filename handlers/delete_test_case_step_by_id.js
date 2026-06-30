export async function handleDeleteTestCaseStepById(tp, id) {
    const result = await tp.deleteTestStep(id);
    if (!result.ok) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to delete test step id: ${id}\n` +
                        `HTTP status: ${result.status}\n` +
                        `Response body: ${result.body}`
                }],
        };
    }
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({ deleted: true, testStepId: Number(id), testStep: result.data })
            }],
    };
}
