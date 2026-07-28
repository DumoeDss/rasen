import { printParseErrorCode, visit } from 'jsonc-parser';

import { WORKFLOW_PACKAGE_LIMITS } from './limits.js';

export interface JsonPreflightIssue {
  code: string;
  message: string;
  offset?: number;
  details?: Record<string, number | string>;
}

const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

export function preflightJson(text: string): JsonPreflightIssue[] {
  const issues: JsonPreflightIssue[] = [];
  const propertySets: Set<string>[] = [];
  let depth = 0;
  let propertyCount = 0;

  const beginContainer = (offset: number): void => {
    depth += 1;
    if (depth > WORKFLOW_PACKAGE_LIMITS.maxJsonDepth) {
      issues.push({
        code: 'json_depth_exceeded',
        message: `JSON nesting exceeds ${WORKFLOW_PACKAGE_LIMITS.maxJsonDepth}`,
        offset,
        details: { actual: depth, limit: WORKFLOW_PACKAGE_LIMITS.maxJsonDepth },
      });
    }
  };
  const endContainer = (): void => {
    depth -= 1;
  };

  visit(
    text,
    {
      onObjectBegin: (offset) => {
        beginContainer(offset);
        propertySets.push(new Set());
      },
      onObjectProperty: (property, offset) => {
        propertyCount += 1;
        if (propertyCount > WORKFLOW_PACKAGE_LIMITS.maxJsonProperties) {
          issues.push({
            code: 'json_property_limit_exceeded',
            message: `JSON contains more than ${WORKFLOW_PACKAGE_LIMITS.maxJsonProperties} object properties`,
            offset,
            details: {
              actual: propertyCount,
              limit: WORKFLOW_PACKAGE_LIMITS.maxJsonProperties,
            },
          });
        }
        const current = propertySets[propertySets.length - 1];
        if (current.has(property)) {
          issues.push({
            code: 'json_duplicate_key',
            message: `Duplicate JSON key "${property}"`,
            offset,
          });
        }
        current.add(property);
        if (DANGEROUS_KEYS.has(property)) {
          issues.push({
            code: 'json_dangerous_key',
            message: `JSON key "${property}" is not allowed`,
            offset,
          });
        }
        if (LONE_SURROGATE.test(property)) {
          issues.push({
            code: 'json_lone_surrogate',
            message: 'JSON property name contains a lone surrogate',
            offset,
          });
        }
      },
      onObjectEnd: () => {
        propertySets.pop();
        endContainer();
      },
      onArrayBegin: (offset) => beginContainer(offset),
      onArrayEnd: () => endContainer(),
      onLiteralValue: (value, offset) => {
        if (typeof value === 'string' && LONE_SURROGATE.test(value)) {
          issues.push({
            code: 'json_lone_surrogate',
            message: 'JSON string contains a lone surrogate',
            offset,
          });
        }
        if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
          issues.push({
            code: 'json_unsafe_integer',
            message: 'JSON integer is outside the safe integer range',
            offset,
          });
        }
      },
      onError: (error, offset) => {
        issues.push({
          code: 'json_syntax_invalid',
          message: printParseErrorCode(error),
          offset,
        });
      },
    },
    {
      disallowComments: true,
      allowTrailingComma: false,
      allowEmptyContent: false,
    }
  );

  return issues;
}

