import { JSDOM } from 'jsdom'
export type Descriptor = { Name: string; Type?: string; Uri?: string; CanGet?: boolean; CanSet?: boolean; CanAdd?: boolean; CanRemove?: boolean; Description?: string }
export function fields(value: unknown): Map<string, Descriptor> {
  const found = new Map<string, Descriptor>()
  function scan(node: unknown) {
    if (!node || typeof node !== 'object') return
    const object = node as Record<string, unknown>
    if (typeof object.Name === 'string' && ('Type' in object || 'CanSet' in object || 'CanGet' in object)) found.set(object.Name, object as Descriptor)
    for (const child of Object.values(object)) if (typeof child === 'object') scan(child)
  }
  scan(value)
  return found
}
export function equivalentMarkup(left: string | null | undefined, right: string | null | undefined): boolean {
  function canonical(value: string) {
    const dom = new JSDOM('<!doctype html><body>' + value.replace(/\r\n?/g, '\n'))
    try {
      function visit(node: Node): unknown {
        if (node.nodeType === 3) return ['text', node.nodeValue]
        if (node.nodeType !== 1) return [node.nodeType, node.nodeValue]
        const element = node as Element
        return [element.tagName.toLowerCase(), Array.from(element.attributes).map(a => [a.name, a.value]).sort((a, b) => a[0].localeCompare(b[0])), Array.from(element.childNodes).map(visit)]
      }
      return JSON.stringify(Array.from(dom.window.document.body.childNodes).map(visit))
    } finally { dom.window.close() }
  }
  return canonical(left ?? '') === canonical(right ?? '')
}
export function safeMetadata<T>(value: T): T {
  if (Array.isArray(value)) return value.map(safeMetadata) as T
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, child]) => {
    if (typeof child === 'string' && /(?:uri|url)$/i.test(key)) {
      try {
        const url = new URL(child)
        if (url.username || url.password) return [key, undefined]
        for (const name of [...url.searchParams.keys()]) if (!/^(attachmentid|width|height)$/i.test(name)) url.searchParams.delete(name)
        return [key, url.toString()]
      } catch { return [key, undefined] }
    }
    return [key, safeMetadata(child)]
  })) as T
}
