# Java validation template

beanValidationCore.mustache is the JavaSpring partial from OpenAPI Generator
7.27.0 (Apache-2.0). The only change replaces string minLength/maxLength
@Size with Hibernate Validator @CodePointLength. OpenAPI length counts Unicode
code points; Jakarta @Size counts UTF-16 units in Java strings.

Array sizes and numeric constraints retain the upstream implementation.
Both Java applications use this partial through the root configureContract.
The build fixture verifies template inputs; API tests verify real generated validation.
When upgrading the generator compare this partial with the same upstream version.
Generated Java remains under build, never src or Git.
Upstream: https://github.com/OpenAPITools/openapi-generator/blob/v7.27.0/modules/openapi-generator/src/main/resources/JavaSpring/beanValidationCore.mustache
