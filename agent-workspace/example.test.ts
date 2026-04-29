/**
 * 示例测试文件
 */

describe("示例测试", () => {
  it("应通过基本断言", () => {
    expect(true).toBe(true);
  });

  it("应正确处理数字运算", () => {
    const result = 1 + 2;
    expect(result).toBe(3);
  });

  it("应正确处理字符串拼接", () => {
    const greeting = "Hello" + " " + "World";
    expect(greeting).toBe("Hello World");
  });

  it("应正确处理数组操作", () => {
    const arr = [1, 2, 3];
    expect(arr.length).toBe(3);
    expect(arr.map((n) => n * 2)).toEqual([2, 4, 6]);
  });
});

describe("边界情况测试", () => {
  it("应处理空数组", () => {
    const empty: number[] = [];
    expect(empty.length).toBe(0);
  });

  it("应处理 null 和 undefined", () => {
    expect(null).toBeNull();
    expect(undefined).toBeUndefined();
  });
});
