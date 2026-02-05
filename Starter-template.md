# Steps to getting NODE-TS setup in your environment;

You can always refer back to this doc = $ https://blog.logrocket.com/express-typescript-node/

    *  npm install express dotenv npm install -D typescript ts-node @types/node @types/express nodemon eslint prettier

    Configure TS
    * npx tsc --init 
    {
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}

* Configure .eslintrc.js
 module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  env: {
    node: true,
    es6: true,
  },
};

* Configure .prettierrc
 {
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all"
}

* Setup scripts for watching
"scripts": {
    "build": "tsc",
    "start": "node dist/server.js",
    "dev": "nodemon --watch 'src/**/*.ts' --exec 'ts-node' src/server.ts",
    "lint": "eslint 'src/**/*.ts'"
  },

* [MODS]: Integrate logging, using MORGAN and winston