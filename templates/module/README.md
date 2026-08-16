# Module template

Copy the route, service, and test templates into `src/modules/<module>/`, rename the exported symbols, and add one explicit import plus one registration call to `src/modules/index.ts`.

Keep request/response Zod schemas and `createRoute` definitions in `routes.ts`; keep source access and business behavior in `service.ts`. Every business route must retain `security: [{ serviceToken: [] }]`. The endpoint remains internal to the Service and is not public until an administrator imports or configures it in Platform and publishes a Routing Revision.

Only copy `configuration.ts.template` when the module has runtime business configuration. Import the resulting configuration group explicitly in `src/modules/index.ts`. Do not add empty module descriptors or a runtime plugin registry.
