/** 把中文文案的结构放宽成「同样的键、值是任意字符串」，英文按它来写：缺键会报类型错误。 */
export type Messages<T> = { [K in keyof T]: T[K] extends string ? string : Messages<T[K]> };
