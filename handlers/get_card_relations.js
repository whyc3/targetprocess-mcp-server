export async function handleGetCardRelations(tp, id) {
    const response = await tp.getCardRelations(id);
    if (!response) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get relations for card id: ${id}`
                }],
        };
    }
    const items = response.Items || [];
    if (items.length === 0) {
        return {
            content: [{
                    type: 'text',
                    text: `No relations found for card id: ${id}`,
                }],
        };
    }
    const cardId = Number(id);
    const relations = items.map((relation) => {
        const isMaster = relation.Master.Id === cardId;
        const other = isMaster ? relation.Slave : relation.Master;
        return {
            relationId: relation.Id,
            relationType: relation.RelationType.Name,
            direction: isMaster ? 'outbound' : 'inbound',
            relatedCard: {
                id: other.Id,
                name: other.Name,
                entityType: other.EntityType?.Name,
            },
        };
    });
    return {
        content: [{ type: 'text', text: JSON.stringify(relations) }],
    };
}
