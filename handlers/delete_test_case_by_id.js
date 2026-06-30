export async function handleDeleteTestCaseById(tp, id) {
    const result = await tp.deleteTestCase(id);
    if (!result.ok) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to delete test case id: ${id}\n` +
                        `HTTP status: ${result.status}\n` +
                        `Response body: ${result.body}`
                }],
        };
    }
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({ deleted: true, testCaseId: Number(id), testCase: result.data })
            }],
    };
}
