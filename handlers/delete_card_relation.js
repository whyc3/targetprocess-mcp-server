export async function handleDeleteCardRelation(tp, relationId) {
    const result = await tp.deleteRelation(relationId);
    if (!result.ok) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to delete relation id: ${relationId}\n` +
                        `HTTP status: ${result.status}\n` +
                        `Response body: ${result.body}`
                }],
        };
    }
    return {
        content: [{
                type: 'text',
                text: JSON.stringify({ deleted: true, relationId: Number(relationId), relation: result.data })
            }],
    };
}
