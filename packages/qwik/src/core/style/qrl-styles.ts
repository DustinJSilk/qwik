import { assertQrl } from '../qrl/qrl-class';
import type { QRL } from '../qrl/qrl.public';
import { hashCode } from '../util/hash_code';
import { ComponentStylesPrefixContent } from '../util/markers';

export const styleKey = (qStyles: QRL<string>, index: number): string => {
  assertQrl(qStyles);
  return `${hashCode(qStyles.$hash$)}-${index}`;
};

export const styleHost = (styleId: string): string => {
  return styleId;
};

export const styleContent = (styleId: string): string => {
  return ComponentStylesPrefixContent + styleId;
};

export const serializeSStyle = (scopeIds: string[]) => {
  const value = scopeIds.join('|');
  if (value.length > 0) {
    return value;
  }
  return undefined;
};
