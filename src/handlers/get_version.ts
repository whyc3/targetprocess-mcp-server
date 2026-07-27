export async function handleGetVersion(version: string) {
  return {
    content: [{ type: 'text' as const, text: version }],
  }
}
