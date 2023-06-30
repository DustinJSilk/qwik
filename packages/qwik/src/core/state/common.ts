import type { ContainerState, GetObjID, GetObject } from '../container/container';
import { canSerialize } from '../container/serializers';
import { assertFail, assertTrue } from '../error/assert';
import { QError_verifySerializable, qError } from '../error/error';
import { notifyChange } from '../render/dom/notify-render';
import type { QwikElement } from '../render/dom/virtual-element';
import {
  isSubscriberDescriptor,
  type SubscriberEffect,
  type SubscriberHost,
} from '../use/use-task';
import { isNode } from '../util/element';
import { createError, logError } from '../util/log';
import { isPromise } from '../util/promises';
import { seal } from '../util/qdev';
import { isArray, isFunction, isObject, isSerializableObject } from '../util/types';
import { QObjectFlagsSymbol, QObjectManagerSymbol, QOjectTargetSymbol } from './constants';
import { tryGetContext } from './context';
import type { Signal } from './signal';

export interface SubscriptionManager {
  $groupToManagers$: GroupToManagersMap;
  $createManager$(map?: Subscriptions[]): LocalSubscriptionManager;
  $clearSub$: (sub: SubscriberEffect | SubscriberHost | Node) => void;
  $clearSignal$: (sub: SubscriberSignal) => void;
}

export type QObject<T extends {}> = T & { __brand__: 'QObject' };

export type TargetType = Record<string | symbol, any>;

/**
 * @internal
 */
export const verifySerializable = <T>(value: T, preMessage?: string): T => {
  const seen = new Set();
  return _verifySerializable(value, seen, '_', preMessage);
};

const _verifySerializable = <T>(value: T, seen: Set<any>, ctx: string, preMessage?: string): T => {
  const unwrapped = unwrapProxy(value);
  if (unwrapped == null) {
    return value;
  }
  if (shouldSerialize(unwrapped)) {
    if (seen.has(unwrapped)) {
      return value;
    }
    seen.add(unwrapped);
    if (canSerialize(unwrapped)) {
      return value;
    }
    const typeObj = typeof unwrapped;
    switch (typeObj) {
      case 'object':
        if (isPromise(unwrapped)) {
          return value;
        }
        if (isNode(unwrapped)) {
          return value;
        }
        if (isArray(unwrapped)) {
          let expectIndex = 0;
          // Make sure the array has no holes
          unwrapped.forEach((v, i) => {
            if (i !== expectIndex) {
              throw qError(QError_verifySerializable, unwrapped);
            }
            _verifySerializable(v, seen, ctx + '[' + i + ']');
            expectIndex = i + 1;
          });
          return value;
        }
        if (isSerializableObject(unwrapped)) {
          for (const [key, item] of Object.entries(unwrapped)) {
            _verifySerializable(item, seen, ctx + '.' + key);
          }
          return value;
        }
        break;
      case 'boolean':
      case 'string':
      case 'number':
        return value;
    }
    let message = '';
    if (preMessage) {
      message = preMessage;
    } else {
      message = 'Value cannot be serialized';
    }
    if (ctx !== '_') {
      message += ` in ${ctx},`;
    }
    if (typeObj === 'object') {
      message += ` because it's an instance of "${value?.constructor.name}". You might need to use 'noSerialize()' or use an object literal instead. Check out https://qwik.builder.io/docs/advanced/dollar/`;
    } else if (typeObj === 'function') {
      const fnName = (value as Function).name;
      message += ` because it's a function named "${fnName}". You might need to convert it to a QRL using $(fn):\n\nconst ${fnName} = $(${String(
        value
      )});\n\nPlease check out https://qwik.builder.io/docs/advanced/qrl/ for more information.`;
    }
    console.error('Trying to serialize', value);
    throw createError(message);
  }
  return value;
};
const noSerializeSet = /*#__PURE__*/ new WeakSet<any>();
const weakSerializeSet = /*#__PURE__*/ new WeakSet<any>();

export const shouldSerialize = (obj: any): boolean => {
  if (isObject(obj) || isFunction(obj)) {
    return !noSerializeSet.has(obj);
  }
  return true;
};

export const fastSkipSerialize = (obj: any): boolean => {
  return noSerializeSet.has(obj);
};

export const fastWeakSerialize = (obj: any): boolean => {
  return weakSerializeSet.has(obj);
};

/**
 * Returned type of the `noSerialize()` function. It will be TYPE or undefined.
 *
 * @see noSerialize
 * @public
 */
export type NoSerialize<T> = (T & { __no_serialize__: true }) | undefined;

// <docs markdown="../readme.md#noSerialize">
// !!DO NOT EDIT THIS COMMENT DIRECTLY!!!
// (edit ../readme.md#noSerialize instead)
/**
 * Marks a property on a store as non-serializable.
 *
 * At times it is necessary to store values on a store that are non-serializable. Normally this
 * is a runtime error as Store wants to eagerly report when a non-serializable property is
 * assigned to it.
 *
 * You can use `noSerialize()` to mark a value as non-serializable. The value is persisted in the
 * Store but does not survive serialization. The implication is that when your application is
 * resumed, the value of this object will be `undefined`. You will be responsible for recovering
 * from this.
 *
 * See: [noSerialize Tutorial](http://qwik.builder.io/tutorial/store/no-serialize)
 *
 * @public
 */
// </docs>
export const noSerialize = <T extends object | undefined>(input: T): NoSerialize<T> => {
  if (input != null) {
    noSerializeSet.add(input);
  }
  return input as any;
};

/**
 * @internal
 */
export const _weakSerialize = <T extends Record<string, any>>(input: T): Partial<T> => {
  weakSerializeSet.add(input);
  return input as any;
};

export const isConnected = (sub: SubscriberEffect | SubscriberHost): boolean => {
  if (isSubscriberDescriptor(sub)) {
    return isConnected(sub.$el$);
  } else {
    return !!tryGetContext(sub) || sub.isConnected;
  }
};

/**
 * @public
 */
export const unwrapProxy = <T>(proxy: T): T => {
  return isObject(proxy) ? getProxyTarget<any>(proxy) ?? proxy : proxy;
};

export const getProxyTarget = <T extends Record<string, any>>(obj: T): T | undefined => {
  return (obj as any)[QOjectTargetSymbol];
};

export const getSubscriptionManager = (
  obj: Record<string, any>
): LocalSubscriptionManager | undefined => {
  return (obj as any)[QObjectManagerSymbol];
};

export const getProxyFlags = <T = Record<string, any>>(obj: T): number | undefined => {
  return (obj as any)[QObjectFlagsSymbol];
};

type SubscriberA = readonly [type: 0, host: SubscriberEffect | SubscriberHost];

type SubscriberB = readonly [
  type: 1 | 2,
  host: SubscriberHost,
  signal: Signal,
  elm: QwikElement,
  prop: string
];

type SubscriberC = readonly [
  type: 3 | 4,
  host: SubscriberHost | Text,
  signal: Signal,
  elm: Node | string | QwikElement
];

export type Subscriber = SubscriberA | SubscriberB | SubscriberC;

type A = [type: 0, host: SubscriberEffect | SubscriberHost, key: string | undefined];
type B = [
  type: 1 | 2,
  host: SubscriberHost,
  signal: Signal,
  elm: QwikElement,
  prop: string,
  key: string | undefined
];
type C = [
  type: 3 | 4,
  host: SubscriberHost | Text,
  signal: Signal,
  elm: Node | QwikElement,
  key: string | undefined
];

export type SubscriberSignal = B | C;

export type Subscriptions = A | SubscriberSignal;

export type GroupToManagersMap = Map<
  SubscriberHost | SubscriberEffect | Node,
  LocalSubscriptionManager[]
>;

export const serializeSubscription = (sub: Subscriptions, getObjId: GetObjID) => {
  const type = sub[0];
  const host = typeof sub[1] === 'string' ? sub[1] : getObjId(sub[1]);
  if (!host) {
    return undefined;
  }
  let base = type + ' ' + host;
  let key: string | undefined;
  if (type === 0) {
    key = sub[2];
  } else {
    const signalID = getObjId(sub[2]);
    if (!signalID) {
      return undefined;
    }
    if (type <= 2) {
      key = sub[5];
      base += ` ${signalID} ${must(getObjId(sub[3]))} ${sub[4]}`;
    } else if (type <= 4) {
      key = sub[4];
      const nodeID = typeof sub[3] === 'string' ? sub[3] : must(getObjId(sub[3]));
      base += ` ${signalID} ${nodeID}`;
    } else {
      assertFail('Should not get here');
    }
  }
  if (key) {
    base += ` ${encodeURI(key)}`;
  }
  return base;
};

export const parseSubscription = (sub: string, getObject: GetObject): Subscriptions | undefined => {
  const parts = sub.split(' ');
  const type = parseInt(parts[0], 10);
  assertTrue(parts.length >= 2, 'At least 2 parts');
  const host = getObject(parts[1]);
  if (!host) {
    return undefined;
  }
  if (isSubscriberDescriptor(host) && !host.$el$) {
    return undefined;
  }
  const subscription = [type, host];
  if (type === 0) {
    assertTrue(parts.length <= 3, 'Max 3 parts');
    subscription.push(safeDecode(parts[2]));
  } else if (type <= 2) {
    assertTrue(parts.length === 5 || parts.length === 6, 'Type 1 has 5');
    subscription.push(getObject(parts[2]), getObject(parts[3]), parts[4], safeDecode(parts[5]));
  } else if (type <= 4) {
    assertTrue(parts.length === 4 || parts.length === 5, 'Type 2 has 4');
    subscription.push(getObject(parts[2]), getObject(parts[3]), safeDecode(parts[4]));
  }
  return subscription as any;
};

const safeDecode = (str: string | undefined) => {
  if (str !== undefined) {
    return decodeURI(str);
  }
  return undefined;
};

export const createSubscriptionManager = (containerState: ContainerState): SubscriptionManager => {
  const groupToManagers: GroupToManagersMap = new Map();
  const manager: SubscriptionManager = {
    $groupToManagers$: groupToManagers,
    $createManager$: (initialMap?: Subscriptions[]) => {
      return new LocalSubscriptionManager(groupToManagers, containerState, initialMap);
    },
    $clearSub$: (group: SubscriberHost | SubscriberEffect | Node) => {
      const managers = groupToManagers.get(group);
      if (managers) {
        for (const manager of managers) {
          manager.$unsubGroup$(group);
        }
        groupToManagers.delete(group);
        managers.length = 0;
      }
    },
    $clearSignal$: (signal: SubscriberSignal) => {
      const managers = groupToManagers.get(signal[1]);
      if (managers) {
        for (const manager of managers) {
          manager.$unsubEntry$(signal);
        }
      }
    },
  };
  seal(manager);
  return manager;
};

export class LocalSubscriptionManager {
  readonly $subs$: Subscriptions[];

  constructor(
    private $groupToManagers$: GroupToManagersMap,
    private $containerState$: ContainerState,
    initialMap?: Subscriptions[]
  ) {
    this.$subs$ = [];

    if (initialMap) {
      this.$addSubs$(initialMap);
    }
    seal(this);
  }

  $addSubs$(subs: Subscriptions[]) {
    this.$subs$.push(...subs);
    for (const sub of this.$subs$) {
      this.$addToGroup$(sub[1], this);
    }
  }

  $addToGroup$(group: SubscriberHost | SubscriberEffect | Node, manager: LocalSubscriptionManager) {
    let managers = this.$groupToManagers$.get(group);
    if (!managers) {
      this.$groupToManagers$.set(group, (managers = []));
    }
    if (!managers.includes(manager)) {
      managers.push(manager);
    }
  }

  $unsubGroup$(group: SubscriberEffect | SubscriberHost | Node) {
    const subs = this.$subs$;
    for (let i = 0; i < subs.length; i++) {
      const found = subs[i][1] === group;
      if (found) {
        subs.splice(i, 1);
        i--;
      }
    }
  }

  $unsubEntry$(entry: SubscriberSignal) {
    const [type, group, signal, elm] = entry;
    const subs = this.$subs$;
    if (type === 1 || type === 2) {
      const prop = entry[4];
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const match =
          sub[0] === type &&
          sub[1] === group &&
          sub[2] === signal &&
          sub[3] === elm &&
          sub[4] === prop;
        if (match) {
          subs.splice(i, 1);
          i--;
        }
      }
    } else if (type === 3 || type === 4) {
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        const match = sub[0] === type && sub[1] === group && sub[2] === signal && sub[3] === elm;
        if (match) {
          subs.splice(i, 1);
          i--;
        }
      }
    }
  }

  $addSub$(sub: Subscriber, key?: string) {
    const subs = this.$subs$;
    const group = sub[1];
    if (
      sub[0] === 0 &&
      subs.some(([_type, _group, _key]) => _type === 0 && _group === group && _key === key)
    ) {
      return;
    }
    subs.push([...sub, key] as any);
    this.$addToGroup$(group, this);
  }

  $notifySubs$(key?: string | undefined) {
    const subs = this.$subs$;
    for (const sub of subs) {
      const compare = sub[sub.length - 1];
      if (key && compare && compare !== key) {
        continue;
      }
      notifyChange(sub, this.$containerState$);
    }
  }
}

const must = <T>(a: T): NonNullable<T> => {
  if (a == null) {
    throw logError('must be non null', a);
  }
  return a;
};
