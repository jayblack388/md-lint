import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Types for markdownlint
type Configuration = { [rule: string]: unknown };
type LintError = {
  lineNumber: number;
  ruleNames: string[];
  ruleDescription: string;
  fixInfo?: {
    deleteCount?: number;
    editColumn?: number;
    insertText?: string;
    lineNumber?: number;
  };
};

// Lazy load markdownlint to avoid blocking activation
let markdownlintModule: any = null;

function getMarkdownlint(): any {
  if (!markdownlintModule) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    markdownlintModule = require('markdownlint');
  }
  return markdownlintModule;
}

const DIAGNOSTIC_SOURCE = 'md-lint';
let diagnosticCollection: vscode.DiagnosticCollection;

export function activate(context: vscode.ExtensionContext) {
  try {
    diagnosticCollection = vscode.languages.createDiagnosticCollection(DIAGNOSTIC_SOURCE);
    context.subscriptions.push(diagnosticCollection);

    // Lint on open
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((document) => {
        if (document.languageId === 'markdown') {
          lintDocument(document);
        }
      })
    );

    // Lint on change (debounced)
    let debounceTimer: NodeJS.Timeout | undefined;
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document.languageId === 'markdown') {
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(() => {
            lintDocument(event.document);
          }, 500);
        }
      })
    );

    // Lint on save + optional fix
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.languageId === 'markdown') {
          const config = vscode.workspace.getConfiguration('md-lint');
          if (config.get('fixOnSave', false)) {
            await fixAllInDocument(document);
          }
          lintDocument(document);
        }
      })
    );

    // Clear diagnostics when document closes
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((document) => {
        diagnosticCollection.delete(document.uri);
      })
    );

    // Re-lint when md-lint settings change (no reload needed)
    context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('md-lint')) {
          vscode.workspace.textDocuments.forEach((document) => {
            if (document.languageId === 'markdown') {
              lintDocument(document);
            }
          });
        }
      })
    );

    // Fix All command
    context.subscriptions.push(
      vscode.commands.registerCommand('md-lint.fixAll', async () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
          const beforeDiagnostics = diagnosticCollection.get(editor.document.uri) || [];
          const fixableCount = beforeDiagnostics.filter((d: any) => d.fixInfo).length;
          
          if (fixableCount === 0) {
            vscode.window.showInformationMessage('No auto-fixable issues found');
            return;
          }
          
          await fixAllInDocument(editor.document);
          vscode.window.showInformationMessage(`Fixed ${fixableCount} issues`);
        }
      })
    );

    // Register code action provider
    context.subscriptions.push(
      vscode.languages.registerCodeActionsProvider(
        { language: 'markdown', scheme: 'file' },
        new MarkdownLintCodeActionProvider(),
        { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
      )
    );

    // Manual lint command
    context.subscriptions.push(
      vscode.commands.registerCommand('md-lint.lint', () => {
        const editor = vscode.window.activeTextEditor;
        if (editor && editor.document.languageId === 'markdown') {
          lintDocument(editor.document);
          const diagnostics = diagnosticCollection.get(editor.document.uri) || [];
          const fixable = diagnostics.filter((d: any) => d.fixInfo).length;
          vscode.window.showInformationMessage(
            `Found ${diagnostics.length} issues (${fixable} auto-fixable)`
          );
        } else {
          vscode.window.showWarningMessage('Open a Markdown file first');
        }
      })
    );

    // Defer initial linting to not block activation
    setTimeout(() => {
      vscode.workspace.textDocuments.forEach((document) => {
        if (document.languageId === 'markdown') {
          lintDocument(document);
        }
      });
    }, 1000);

  } catch (error) {
    vscode.window.showErrorMessage(`md-lint activation failed: ${error}`);
  }
}

const DEFAULT_CONFIG: Configuration = { default: true };

function getConfig(documentUri: vscode.Uri): Configuration {
  const config = vscode.workspace.getConfiguration('md-lint');
  const settingsConfig = config.get<Configuration>('config');

  // Settings override: merge with default so partial configs (e.g. only MD013: false) work
  if (settingsConfig && typeof settingsConfig === 'object') {
    const keys = Object.keys(settingsConfig);
    if (keys.length > 0) {
      return { ...DEFAULT_CONFIG, ...settingsConfig };
    }
  }

  // Look for .markdownlint.json in workspace
  const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri);
  if (workspaceFolder) {
    const configPaths = [
      '.markdownlint.json',
      '.markdownlint.yaml',
      '.markdownlint.yml',
      '.markdownlintrc'
    ];

    for (const configPath of configPaths) {
      const fullPath = path.join(workspaceFolder.uri.fsPath, configPath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath, 'utf8');
          return JSON.parse(content) as Configuration;
        } catch {
          // Ignore parse errors
        }
      }
    }
  }

  return { ...DEFAULT_CONFIG };
}

function lintDocument(document: vscode.TextDocument) {
  const config = vscode.workspace.getConfiguration('md-lint');
  if (!config.get('enable', true)) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const text = document.getText();
  const markdownlintConfig = getConfig(document.uri);

  try {
    const markdownlint = getMarkdownlint();
    
    const options: any = {
      strings: { content: text },
      config: markdownlintConfig,
    };

    const results = markdownlint.sync(options);
    const lintErrors: LintError[] = results.content || [];

    console.log(`md-lint: Found ${lintErrors.length} issues in ${document.fileName}`);

    const diagnostics: vscode.Diagnostic[] = lintErrors.map((error: LintError) => {
      const line = error.lineNumber - 1;
      const range = new vscode.Range(line, 0, line, Number.MAX_VALUE);

      const diagnostic = new vscode.Diagnostic(
        range,
        `${error.ruleNames.join('/')}: ${error.ruleDescription}`,
        vscode.DiagnosticSeverity.Warning
      );

      diagnostic.source = DIAGNOSTIC_SOURCE;
      diagnostic.code = error.ruleNames[0];

      // Store fix info if available
      if (error.fixInfo) {
        (diagnostic as any).fixInfo = error.fixInfo;
        (diagnostic as any).lineNumber = error.lineNumber;
      }

      return diagnostic;
    });

    diagnosticCollection.set(document.uri, diagnostics);
  } catch (error) {
    console.error('md-lint error:', error);
  }
}

async function fixAllInDocument(document: vscode.TextDocument): Promise<void> {
  const text = document.getText();
  const markdownlintConfig = getConfig(document.uri);

  const markdownlint = getMarkdownlint();
  
  const options: any = {
    strings: { content: text },
    config: markdownlintConfig,
  };

  const results = markdownlint.sync(options);
  const lintErrors: LintError[] = results.content || [];

  // Filter errors that have fix info
  const fixableErrors = lintErrors.filter(e => e.fixInfo);
  
  if (fixableErrors.length === 0) {
    return;
  }

  // Use markdownlint's applyFixes helper for reliable fixing
  const fixes = fixableErrors.map(error => ({
    lineNumber: error.lineNumber,
    fixInfo: error.fixInfo
  }));

  const fixedText = applyFixesManually(text, fixes);
  
  if (fixedText !== text) {
    const fullRange = new vscode.Range(
      document.positionAt(0),
      document.positionAt(text.length)
    );
    
    const edit = new vscode.WorkspaceEdit();
    edit.replace(document.uri, fullRange, fixedText);
    await vscode.workspace.applyEdit(edit);
  }
}

// Manual implementation of applyFixes that handles all markdownlint fix scenarios
function applyFixesManually(text: string, fixes: Array<{ lineNumber: number; fixInfo: any }>): string {
  const lines = text.split('\n');
  
  // Sort fixes by line number descending, then by column descending
  // This ensures we apply fixes from bottom-to-top, right-to-left
  const sortedFixes = [...fixes].sort((a, b) => {
    const lineDiff = b.lineNumber - a.lineNumber;
    if (lineDiff !== 0) return lineDiff;
    const colA = a.fixInfo.editColumn || 1;
    const colB = b.fixInfo.editColumn || 1;
    return colB - colA;
  });
  
  for (const { lineNumber, fixInfo } of sortedFixes) {
    const lineIndex = lineNumber - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) continue;
    
    let line = lines[lineIndex];
    const editColumn = (fixInfo.editColumn || 1) - 1; // Convert to 0-based
    const deleteCount = fixInfo.deleteCount || 0;
    const insertText = fixInfo.insertText || '';
    
    // Handle line deletion (deleteCount === -1 means delete entire line)
    if (deleteCount === -1) {
      lines.splice(lineIndex, 1);
      continue;
    }
    
    // Apply the fix: delete characters and insert new text
    const before = line.substring(0, editColumn);
    const after = line.substring(editColumn + deleteCount);
    lines[lineIndex] = before + insertText + after;
  }
  
  return lines.join('\n');
}

function applyFix(
  document: vscode.TextDocument,
  lineNumber: number,
  fixInfo: any
): { range: vscode.Range; newText: string } | null {
  const lineIndex = lineNumber - 1;
  
  if (lineIndex < 0 || lineIndex >= document.lineCount) {
    return null;
  }

  const deleteCount = fixInfo.deleteCount || 0;
  const editColumn = (fixInfo.editColumn || 1) - 1; // Convert to 0-based
  const insertText = fixInfo.insertText || '';

  // Handle line deletion (deleteCount === -1 means delete entire line)
  if (deleteCount === -1) {
    // Delete the entire line including the newline
    const startPos = new vscode.Position(lineIndex, 0);
    const endPos = lineIndex + 1 < document.lineCount 
      ? new vscode.Position(lineIndex + 1, 0)
      : new vscode.Position(lineIndex, document.lineAt(lineIndex).text.length);
    return { range: new vscode.Range(startPos, endPos), newText: '' };
  }

  // Handle character deletion and/or insertion
  if (deleteCount > 0) {
    const range = new vscode.Range(lineIndex, editColumn, lineIndex, editColumn + deleteCount);
    return { range, newText: insertText };
  }

  // Handle insert-only (deleteCount === 0)
  if (insertText) {
    const range = new vscode.Range(lineIndex, editColumn, lineIndex, editColumn);
    return { range, newText: insertText };
  }

  return null;
}

class MarkdownLintCodeActionProvider implements vscode.CodeActionProvider {
  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext
  ): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];

    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== DIAGNOSTIC_SOURCE) {
        continue;
      }

      const fixInfo = (diagnostic as any).fixInfo;
      const lineNumber = (diagnostic as any).lineNumber;

      if (fixInfo && lineNumber) {
        const fix = applyFix(document, lineNumber, fixInfo);
        if (fix) {
          const action = new vscode.CodeAction(
            `Fix: ${diagnostic.message}`,
            vscode.CodeActionKind.QuickFix
          );

          action.edit = new vscode.WorkspaceEdit();
          action.edit.replace(document.uri, fix.range, fix.newText);
          action.diagnostics = [diagnostic];
          action.isPreferred = true;

          actions.push(action);
        }
      }
    }

    // Add "Fix All" action if there are fixable diagnostics
    const allDiagnostics = diagnosticCollection.get(document.uri) || [];
    const fixableCount = allDiagnostics.filter((d: any) => d.fixInfo).length;

    if (fixableCount > 1) {
      const fixAllAction = new vscode.CodeAction(
        `Fix all ${fixableCount} markdown lint issues`,
        vscode.CodeActionKind.QuickFix
      );
      fixAllAction.command = {
        command: 'md-lint.fixAll',
        title: 'Fix All Markdown Lint Issues',
      };
      actions.push(fixAllAction);
    }

    return actions;
  }
}

export function deactivate() {
  if (diagnosticCollection) {
    diagnosticCollection.dispose();
  }
}
