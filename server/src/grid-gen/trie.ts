/** Trie 节点 */
export class TrieNode {
  children = new Map<string, TrieNode>()
  isWord = false
  word = ''
}

/**
 * Trie 前缀树，词库内存索引
 * - hasPrefix 用于潜在词池 DFS 剪枝
 * - hasWord 用于查词
 */
export class Trie {
  private root = new TrieNode()

  insert(word: string): void {
    let node = this.root
    for (const ch of word) {
      let next = node.children.get(ch)
      if (!next) {
        next = new TrieNode()
        node.children.set(ch, next)
      }
      node = next
    }
    node.isWord = true
    node.word = word
  }

  private findNode(prefix: string): TrieNode | null {
    let node = this.root
    for (const ch of prefix) {
      const next = node.children.get(ch)
      if (!next) return null
      node = next
    }
    return node
  }

  hasPrefix(prefix: string): boolean {
    return this.findNode(prefix) !== null
  }

  hasWord(word: string): boolean {
    const node = this.findNode(word)
    return node !== null && node.isWord
  }
}
