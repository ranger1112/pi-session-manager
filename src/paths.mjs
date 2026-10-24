import { resolve } from 'node:path';

// Windows 路径大小写不敏感；其余平台按原样解析。
export const pathKey = path => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);

// 缺失或空路径不视为相同：空 cwd 表示未知，不能折叠成进程工作目录。
export const pathsEqual = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a !== '' && b !== '' && pathKey(a) === pathKey(b);
