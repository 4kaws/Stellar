# Third-party notices

The original code and documentation in Stellar are offered under `MIT OR Apache-2.0`. Third-party material retains its original license and copyright notices; the project's license choice does not relicense it.

The source repository does not distribute the downloaded Dafny, Z3, or .NET binaries. Setup downloads the pinned upstream toolchain. If you separately redistribute those tools, preserve their upstream licenses and notices, including notices for bundled dependencies.

## Dafny 4.11.0 JavaScript runtime — MIT

The generated JavaScript package includes runtime code emitted by Dafny. Its generated source header identifies it as follows:

```text
Copyright by the contributors to the Dafny Project
SPDX-License-Identifier: MIT
```

Keep that header and the following license with redistributed generated packages. The license text below is from the [Dafny 4.11.0 upstream license](https://github.com/dafny-lang/dafny/blob/v4.11.0/LICENSE.txt). The upstream tool distribution also has [third-party notices](https://github.com/dafny-lang/dafny/blob/v4.11.0/NOTICES.txt).

```text
Dafny

Copyright (c) Microsoft Corporation

All rights reserved.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the ""Software""), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED *AS IS*, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## bignumber.js 9.3.1 — MIT

The generated package uses [bignumber.js](https://github.com/MikeMcl/bignumber.js) for arbitrary-precision arithmetic. Its original `LICENCE.md` remains in the bundled dependency directory. The following reproduces that file from the pinned 9.3.1 npm package without changing its notice or terms.

```text
The MIT License (MIT)
=====================

Copyright © `<2025>` `Michael Mclaughlin`

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the “Software”), to deal in the Software without
restriction, including without limitation the rights to use,
copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the
Software is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
OTHER DEALINGS IN THE SOFTWARE.
```
