import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';
import * as ts from 'typescript';

const CORE_TYPES = path.join(process.cwd(), 'src/core/management-api/wire-types.ts');
const UI_TYPES = path.join(process.cwd(), 'packages/ui/src/api/types.ts');
const MIRRORED_DECLARATIONS = [
  'SpaceMember',
  'ProjectSpaceEntry',
  'StoreSpaceEntry',
  'CreateSpaceRequest',
  'CreateSpaceResponse',
  'AddProjectToStoreResponse',
] as const;

function declarationNamespace(namespace: string, fileName: string): string {
  const source = fs.readFileSync(fileName, 'utf8');
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const declarations = MIRRORED_DECLARATIONS.map((name) => {
    const statement = sourceFile.statements.find(
      (candidate) =>
        (ts.isInterfaceDeclaration(candidate) || ts.isTypeAliasDeclaration(candidate))
        && candidate.name.text === name
    );
    if (!statement) throw new Error(`${name} is not declared in ${fileName}`);
    return statement.getText(sourceFile);
  });
  return `namespace ${namespace} {\n${declarations.join('\n')}\n}`;
}

function compile(source: string): ts.Diagnostic[] {
  const fileName = '/space-creation-wire-mirror-probe.ts';
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true);
  const host: ts.CompilerHost = {
    getSourceFile: (name) => (name === fileName ? sourceFile : undefined),
    writeFile: () => undefined,
    getDefaultLibFileName: () => 'lib.d.ts',
    useCaseSensitiveFileNames: () => true,
    getCanonicalFileName: (name) => name,
    getCurrentDirectory: () => '/',
    getNewLine: () => '\n',
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? source : undefined),
  };
  const program = ts.createProgram([fileName], { strict: true, noEmit: true, noLib: true }, host);
  return [...program.getSemanticDiagnostics(), ...program.getSyntacticDiagnostics()];
}

/**
 * Extract complete declarations through the TypeScript AST, then compile both
 * source realms together. A bare `expectTypeOf` would be a runtime no-op here
 * because the root tsconfig excludes `test/`.
 */
function compileMirrorProbe(injectOptionalUiResponseDrift = false): ts.Diagnostic[] {
  const uiResponseUnderTest = injectOptionalUiResponseDrift
    ? 'AddOptionalDrift<Ui.CreateSpaceResponse>'
    : 'Ui.CreateSpaceResponse';
  const uiAddProjectUnderTest = injectOptionalUiResponseDrift
    ? 'AddOptionalDrift<Ui.AddProjectToStoreResponse>'
    : 'Ui.AddProjectToStoreResponse';
  const source = `
type Extract<T, U> = T extends U ? T : never;
${declarationNamespace('Core', CORE_TYPES)}
${declarationNamespace('Ui', UI_TYPES)}

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2)
    ? (<Value>() => Value extends Right ? 1 : 2) extends
      (<Value>() => Value extends Left ? 1 : 2)
      ? true
      : false
    : false;
type Assert<Condition extends true> = Condition;
type Materialize<Value> = { [Key in keyof Value]: Value[Key] };
type AddOptionalDrift<Response> = Response extends unknown
  ? Materialize<Response & { optionalDrift?: string }>
  : never;

// Normalize only the one known catalog boundary: core permits a rootless space
// while the browser mirror retains navigable spaces. Every other space key and
// every top-level response key (including optional modifiers) is preserved.
type NormalizeSpaceRoot<Space> = Space extends { root?: string }
  ? Materialize<
      { [Key in keyof Space as Key extends 'root' ? never : Key]: Space[Key] }
      & { root: string }
    >
  : Space;
type NormalizeResponse<Response> = Response extends { space: unknown }
  ? { [Key in keyof Response]: Key extends 'space' ? NormalizeSpaceRoot<Response[Key]> : Response[Key] }
  : Response;

type _RequestMirror = Assert<Equal<Core.CreateSpaceRequest, Ui.CreateSpaceRequest>>;
type _ResponseMirror = Assert<
  Equal<NormalizeResponse<Core.CreateSpaceResponse>, NormalizeResponse<${uiResponseUnderTest}>>
>;
type _AddProjectMirror = Assert<
  Equal<
    NormalizeResponse<Core.AddProjectToStoreResponse>,
    NormalizeResponse<${uiAddProjectUnderTest}>
  >
>;
`;
  return compile(source);
}

describe('space mutation wire types keep the UI mirror exact', () => {
  it('type-checks strict equality for every request and normalized response member', () => {
    const diagnostics = compileMirrorProbe();
    expect(
      diagnostics.map((diagnostic) => ({
        code: diagnostic.code,
        message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      }))
    ).toEqual([]);
  });

  it('rejects an optional top-level response field added to only one mirror', () => {
    const diagnostics = compileMirrorProbe(true);
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([2344, 2344]);
    expect(
      diagnostics.every((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n').includes(
          "Type 'false' does not satisfy the constraint 'true'"
        )
      )
    ).toBe(true);
  });
});
