# Distribucion Windows

Aplicacion: Gestion Documental SAG Cauca

Este proyecto genera un instalador Windows NSIS con electron-builder. La configuracion esta preparada para instalacion empresarial por usuario, firma digital mediante variables de entorno y preservacion de datos locales.

## Generar el instalador

Requisitos en la maquina de build:

- Windows 10/11.
- Node.js y npm solo en la maquina de build.
- Dependencias instaladas con `npm install`.

Comando:

```powershell
cd "D:\sag\segundo trimestre\marzo buscador\gestion-documental-electron"
npm.cmd run package
```

Salida esperada:

```text
dist\Gestion-Documental-SAG-Cauca-Setup-1.0.0.exe
```

Ese `.exe` es el archivo que se entrega al cliente.

## Firma digital

electron-builder firma Windows automaticamente si encuentra un certificado valido en variables de entorno. No se debe guardar ningun certificado ni contrasena en Git.

Variables soportadas:

- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`

Para Windows se recomienda usar `WIN_CSC_LINK` y `WIN_CSC_KEY_PASSWORD` cuando el certificado se usa solo para builds Windows.

`WIN_CSC_LINK` puede apuntar a:

- Una ruta local a un `.pfx` o `.p12` en la maquina de build.
- Una URL privada y controlada por el equipo de build.
- Un valor base64 del certificado, si el proceso CI/CD lo maneja asi.

No commitear:

- `.pfx`
- `.p12`
- claves privadas
- passwords
- archivos `.env` con secretos

## Variables en PowerShell

Solo para la sesion actual:

```powershell
$env:WIN_CSC_LINK="C:\certificados\sag-cauca-code-signing.pfx"
$env:WIN_CSC_KEY_PASSWORD="CONTRASENA_DEL_CERTIFICADO"
npm.cmd run package
```

Persistente para el usuario actual:

```powershell
[Environment]::SetEnvironmentVariable("WIN_CSC_LINK", "C:\certificados\sag-cauca-code-signing.pfx", "User")
[Environment]::SetEnvironmentVariable("WIN_CSC_KEY_PASSWORD", "CONTRASENA_DEL_CERTIFICADO", "User")
```

Luego abrir una nueva terminal y ejecutar:

```powershell
npm.cmd run package
```

## Variables en Git Bash

Solo para la sesion actual:

```bash
export WIN_CSC_LINK="/c/certificados/sag-cauca-code-signing.pfx"
export WIN_CSC_KEY_PASSWORD="CONTRASENA_DEL_CERTIFICADO"
npm run package
```

## Que entregar al cliente

Entregar:

```text
dist\Gestion-Documental-SAG-Cauca-Setup-1.0.0.exe
```

No entregar:

- `dist\win-unpacked\`
- `dist\*.blockmap`
- `dist\builder-debug.yml`
- `dist\builder-effective-config.yaml`
- `node_modules\`
- codigo fuente
- certificados
- contrasenas
- bases de datos locales
- logs
- carpetas `data`, `reports`, `test_docs` o `scripts`

## Configuracion del instalador

El instalador NSIS esta configurado como asistente clasico:

- `oneClick: false`
- flujo tipo Siguiente, Instalar, Finalizar
- acceso directo en escritorio
- acceso directo en menu inicio
- instalacion por usuario
- no solicita instalacion por maquina
- no elimina datos de usuario al desinstalar

Los datos de usuario se conservan porque:

```json
"deleteAppDataOnUninstall": false
```

## Ruta de datos

En produccion, Electron usa `app.getPath("userData")` con nombre de app:

```text
Gestion Documental SAG Cauca
```

La base de datos se crea en:

```text
%APPDATA%\Gestion Documental SAG Cauca\data\app.db
```

Ruta equivalente habitual:

```text
C:\Users\<usuario>\AppData\Roaming\Gestion Documental SAG Cauca\data\app.db
```

En desarrollo se usa:

```text
electron-user-data\data\app.db
```

## Comportamiento en produccion

En la app empaquetada:

- Electron inicia el backend embebido.
- El backend usa `127.0.0.1`.
- El puerto es dinamico (`PORT=0`).
- Electron abre la URL real devuelta por el servidor.
- No depende de `localhost:3000`.
- La maquina final no necesita Node.js, npm, VS Code ni Git.

## Icono

El icono Windows esta en:

```text
build\icon.ico
```

Debe incluir resoluciones:

- 16x16
- 32x32
- 48x48
- 64x64
- 128x128
- 256x256

Si se actualiza el logo institucional, regenerar `build\icon.ico` desde una fuente cuadrada de alta calidad, preferiblemente PNG o JPG de 1024x1024 o superior. La fuente actual usada por el proyecto es:

```text
frontend\assets\logo-sag.jpg
```

## Probar en otra maquina

1. Copiar solo `dist\Gestion-Documental-SAG-Cauca-Setup-1.0.0.exe`.
2. Ejecutar el instalador.
3. Confirmar que aparece el asistente NSIS.
4. Instalar sin privilegios de administrador.
5. Confirmar accesos directos en escritorio y menu inicio.
6. Abrir la aplicacion.
7. Confirmar que no pide Node.js, npm, VS Code ni Git.
8. Confirmar que se crea:

```text
%APPDATA%\Gestion Documental SAG Cauca\data\app.db
```

9. Desinstalar y confirmar que los datos no se eliminan automaticamente.

## SmartScreen

Una firma digital valida reduce advertencias porque identifica el publicador y protege la integridad del instalador.

Sin certificado real no se puede quitar completamente la advertencia de Windows.

Incluso con certificado, SmartScreen puede seguir apareciendo al inicio si el certificado o el instalador aun no tienen reputacion suficiente. Esto es normal en primeras distribuciones. La reputacion mejora con instalaciones reales, ausencia de reportes y consistencia de firma en versiones futuras.

Para distribucion empresarial, usar un certificado de code signing emitido por una CA reconocida. Un certificado EV suele ayudar mas con reputacion inicial, pero no reemplaza las validaciones internas de Microsoft SmartScreen.
