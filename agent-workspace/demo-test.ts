/**
 * 一个被 apply_patch 修改过的测试文件
 */

const GREETING = "Hello, Patch!";
const PI = 3.14;

interface Cat {
  name: string;
  age: number;
  color: string;
  breed: string;
}

function describeCat(cat: Cat): string {
  return `${cat.name} 是一只 ${cat.age} 岁的${cat.color}猫。`;
}

const myCat: Cat = { name: "布丁", age: 2, color: "白", breed: "英短" };
console.log(describeCat(myCat));
console.log(`圆周率大约是 ${PI}`);
console.log(`问候语: ${GREETING}`);

export { describeCat, GREETING, PI };
