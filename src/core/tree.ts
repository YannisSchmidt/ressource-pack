import type { FileEntry, TreeNode } from '../shared/types';

interface MutableNode extends Omit<TreeNode, 'children'> {
  children: MutableNode[];
  childMap: Map<string, MutableNode>;
}

function createNode(path: string, name: string): MutableNode {
  return { path, name, files: 0, totalFiles: 0, children: [], childMap: new Map() };
}

/** Construit l'arborescence des dossiers à partir des chemins relatifs indexés. */
export function buildTree(entries: FileEntry[]): TreeNode {
  const root = createNode('', '');
  for (const entry of entries) {
    if (!entry.dir) {
      root.files += 1;
      root.totalFiles += 1;
      continue;
    }
    let current = root;
    let currentPath = '';
    for (const segment of entry.dir.split('/')) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let child = current.childMap.get(segment);
      if (!child) {
        child = createNode(currentPath, segment);
        current.childMap.set(segment, child);
        current.children.push(child);
      }
      current = child;
    }
    current.files += 1;
    // Chaque ancêtre voit son total augmenter.
    let ancestor: MutableNode | undefined = root;
    ancestor.totalFiles += 1;
    let prefix = '';
    for (const segment of entry.dir.split('/')) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      ancestor = ancestor?.childMap.get(segment);
      if (ancestor) ancestor.totalFiles += 1;
    }
  }
  const finalize = (node: MutableNode): TreeNode => {
    node.children.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    return {
      path: node.path,
      name: node.name,
      files: node.files,
      totalFiles: node.totalFiles,
      children: node.children.map(finalize),
    };
  };
  return finalize(root);
}

export function countFolders(tree: TreeNode): number {
  return tree.children.reduce((sum, child) => sum + 1 + countFolders(child), 0);
}
