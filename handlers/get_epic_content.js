import { JSDOM } from 'jsdom';
export async function handleGetEpicContent(tp, id) {
    const epic = await tp.getEpic(id);
    if (!epic) {
        return {
            content: [{
                    type: 'text',
                    text: `Failed to get epic, id: ${id}\n JSON: ${JSON.stringify(epic, null, 2)}`
                }],
        };
    }
    const result = {
        name: epic.Name,
        id: epic.Id,
        description: '',
        entityState: epic.EntityState?.Name,
        release: epic.Release?.Name,
        portfolioEpic: epic.PortfolioEpic?.Name,
        progress: epic.Progress,
        effort: epic.Effort,
        customFields: epic.CustomFields,
    };
    const description = epic.Description || '';
    if (description) {
        try {
            const dom = new JSDOM(`<html><body><div id="content">${description}</div></body></html>`);
            const text = dom.window.document.getElementById('content')?.textContent;
            if (text)
                result.description = text;
        }
        catch (error) {
            console.error('Error parsing epic description:', error);
        }
    }
    return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
    };
}
