# AGENTS.md - Agentic Coding Guidelines for Flowise

## Overview

Flowise is a monorepo for building AI agents visually. It consists of multiple packages:

-   `packages/server` - Node.js backend API
-   `packages/ui` - React frontend
-   `packages/components` - Third-party node integrations (LangChain, etc.)
-   `packages/agentflow` - Embeddable React component for visualizing AI workflows
-   `packages/api-documentation` - Auto-generated Swagger documentation

## Build Commands

### Root Commands

```bash
pnpm install           # Install all dependencies
pnpm build             # Build all packages
pnpm build-force       # Clean and force rebuild
pnpm dev               # Run all packages in development mode
pnpm start             # Start production server
pnpm test              # Run tests for all packages
pnpm test:coverage     # Run tests with coverage
pnpm lint              # Lint all files
pnpm lint-fix          # Lint and auto-fix
pnpm format            # Format code with Prettier
pnpm clean             # Clean build artifacts
pnpm nuke              # Remove all node_modules and build artifacts
```

### Package-Specific Commands

**Server (`packages/server`):**

```bash
pnpm test --filter=flowise                    # Run server tests
pnpm test --filter=flowise -- --testNamePattern="testName"  # Run single test
pnpm build                                     # Build server
pnpm dev                                       # Development mode
pnpm e2e                                       # Run Cypress e2e tests
```

**Components (`packages/components`):**

```bash
pnpm test --filter=flowise-components                    # Run component tests
pnpm test --filter=flowise-components --testNamePattern="testName"
pnpm test:watch --filter=flowise-components               # Watch mode
pnpm test:coverage --filter=flowise-components           # With coverage
pnpm lint --filter=flowise-components                      # Lint components
```

**Agentflow (`packages/agentflow`):**

```bash
pnpm test --filter=@flowiseai/agentflow                   # Run tests
pnpm test:watch --filter=@flowiseai/agentflow              # Watch mode
pnpm test:coverage --filter=@flowiseai/agentflow           # Coverage
pnpm lint --filter=@flowiseai/agentflow                     # Lint
pnpm lint:fix --filter=@flowiseai/agentflow                 # Auto-fix
pnpm format --filter=@flowiseai/agentflow                   # Format
pnpm dev --filter=@flowiseai/agentflow                      # Dev server
```

### Running a Single Test

```bash
# Server
cd packages/server && pnpm test -- --testNamePattern="myTest"

# Components
cd packages/components && pnpm test --testNamePattern="myTest"

# Agentflow
cd packages/agentflow && pnpm test --testNamePattern="myTest"
```

## Code Style Guidelines

### Formatting (Prettier)

Configuration in `package.json`:

```json
{
    "prettier": {
        "printWidth": 140,
        "singleQuote": true,
        "jsxSingleQuote": true,
        "trailingComma": "none",
        "tabWidth": 4,
        "semi": false,
        "endOfLine": "auto"
    }
}
```

**Rules:**

-   140 characters max line width
-   Single quotes for strings (including JSX)
-   4 spaces for indentation
-   No trailing commas
-   No semicolons
-   Use `pnpm format` to auto-format

### Linting (ESLint)

Configuration files:

-   Root: `.eslintrc.js`
-   Agentflow: `packages/agentflow/.eslintrc.js`

**Core Rules:**

-   TypeScript is required (`@typescript-eslint/parser`)
-   React and React Hooks linting enabled
-   Prettier integration for formatting
-   Unused imports trigger warnings
-   Console warnings allowed in development, errors in CI

**Agentflow-specific rules:**

-   Import sorting with `simple-import-sort`
-   No duplicate imports
-   Newlines after imports
-   Architectural boundaries enforced

### TypeScript

-   **Strict mode enabled** in all packages
-   Use explicit types for function parameters and return types
-   Prefer interfaces over types for object shapes
-   Avoid `any` - use `unknown` if type is truly unknown
-   Use `strict: true` compiler option

### Naming Conventions

| Type        | Convention       | Example                    |
| ----------- | ---------------- | -------------------------- |
| Files       | kebab-case       | `my-component.tsx`         |
| Classes     | PascalCase       | `class FlowService`        |
| Interfaces  | PascalCase       | `interface NodeConfig`     |
| Types       | PascalCase       | `type FlowStatus`          |
| Functions   | camelCase        | `function getNodeConfig()` |
| Variables   | camelCase        | `const nodeConfig = ...`   |
| Constants   | UPPER_SNAKE_CASE | `const MAX_RETRIES = 5`    |
| Enums       | PascalCase       | `enum NodeType`            |
| Enum Values | PascalCase       | `NodeType.CHAT`            |

### Imports

**Order (agentflow - enforced by ESLint):**

1. Side effect imports (`import './style.css'`)
2. React and React-related packages (`^react`, `^react-dom`)
3. Other external packages (`^@?\w`)
4. Internal packages (`^@/`)
5. Parent imports (`^\\.\\.(?!/?$)`, `^\\.\\./?$`)
6. Same directory imports (`^\\./`)
7. CSS/SCSS imports

**Other rules:**

-   Use absolute imports with `@/` alias in agentflow
-   Group related imports together
-   Remove unused imports before committing

### Error Handling

-   Use typed errors (custom Error classes)
-   Always try/catch async operations
-   Log errors with appropriate context using Winston logger
-   Return meaningful error messages to API consumers
-   Use HTTP status codes appropriately (4xx for client errors, 5xx for server errors)

```typescript
// Good
try {
    const result = await someAsyncOperation()
    return result
} catch (error) {
    logger.error('Operation failed', { error, context })
    throw new AppError('Failed to process request', 500)
}
```

### React Components (Agentflow & UI)

-   Use functional components with hooks
-   Use TypeScript for prop types (not PropTypes)
-   Keep components small and focused
-   Extract reusable logic to custom hooks
-   Use memoization (`useMemo`, `useCallback`) judiciously
-   Follow React 18 patterns with `useEffect` for side effects

### File Organization

```
packages/
├── server/
│   ├── src/
│   │   ├── commands/     # CLI commands
│   │   ├── utils/       # Utilities
│   │   ├── routes/      # API routes
│   │   └── index.ts
│   └── test/            # Tests alongside source
├── components/
│   ├── src/
│   │   └── nodes/       # Node implementations
│   └── test/
├── agentflow/
│   ├── src/
│   │   ├── atoms/       # Reusable UI components
│   │   ├── core/        # Core logic (leaf nodes)
│   │   ├── features/    # Feature modules
│   │   ├── infrastructure/  # API, state, external services
│   │   └── index.ts
│   └── __test_utils__/  # Test utilities
└── ui/
    └── src/
```

### Testing

-   Test files use `.test.ts` or `.test.tsx` extension
-   Use Jest (configured in each package)
-   FollowArrange-Act-Assert pattern
-   Mock external dependencies
-   Group tests with `describe` blocks
-   Use descriptive test names

```typescript
describe('NodeValidator', () => {
    describe('validateNodeConfig', () => {
        it('should throw for invalid config', () => {
            // Arrange
            const config = { type: 'invalid' }

            // Act & Assert
            expect(() => validateNodeConfig(config)).toThrow()
        })
    })
})
```

### Architecture Rules (Agentflow)

The agentflow package enforces architectural boundaries via ESLint:

1. **atoms/** - Dumb, reusable UI components

    - Can only import from `core/types`
    - Cannot import from features, infrastructure, or core utils

2. **core/** - Leaf node with business logic

    - Cannot import from atoms, features, or infrastructure
    - Can only import from its own types

3. **infrastructure/** - External integrations (API, state, storage)

    - Cannot import from atoms or features
    - Can only import from core/

4. **features/** - Feature-specific modules
    - Cannot import from other features
    - Share code via core/ utilities

## Git Conventions

-   Use meaningful commit messages
-   Run `pnpm lint-fix` and `pnpm format` before committing
-   Ensure tests pass before pushing
-   Use pre-commit hooks (husky) for linting

## Environment Variables

-   Create `.env` files in respective package directories
-   Use `.env.example` as template
-   Never commit secrets to repository
-   See individual package README.md for required variables

## Additional Resources

-   [Server README](packages/server/README.md)
-   [Components README](packages/components/README.md)
-   [Agentflow README](packages/agentflow/README.md)
-   [Agentflow Architecture](packages/agentflow/ARCHITECTURE.md)
-   [Flowise Documentation](https://docs.flowiseai.com/)
