# Gestión Documental Electron

Aplicación de escritorio local para gestión documental en Windows, construida con Electron, Express y SQLite.

## Alcance actual

El proyecto permite:

- autenticación local con roles `admin` y `user`
- gestión de carpetas raíz documentales
- indexación de archivos desde carpetas activas
- búsqueda y consulta de documentos
- creación de documentos con copia física al repositorio documental
- edición de metadatos
- historial de acciones por documento
- apertura de archivos desde la aplicación

## Tecnologías principales

- Electron
- Express
- SQLite
- JSON Web Token en cookie `httpOnly`
- HTML, CSS y JavaScript vanilla

## Requisitos

- Windows
- Node.js 18 o superior
- npm

## Instalación

Desde PowerShell:

```powershell
cd "d:\sag\segundo trimestre\marzo buscador\gestion-documental-electron"
npm install
npm run init-db
```

## Ejecución

Para abrir la aplicación completa:

```powershell
npm start
```

Esto hace lo siguiente:

- abre la ventana Electron
- inicia la API local en `http://localhost:3000`
- conecta o crea la base de datos en `data\app.db`

Si necesitas arrancar solo la API:

```powershell
npm run start-api
```

## Credenciales de prueba

- `admin / admin123`
- `user / user123`

## Flujo de instalación recomendado

1. Instalar dependencias con `npm install`.
2. Crear o inicializar la base de datos con `npm run init-db`.
3. Ejecutar la aplicación con `npm start`.
4. Ingresar con una cuenta de prueba.
5. Registrar una carpeta raíz documental.
6. Ejecutar indexación o crear documentos manualmente.

## Estructura del proyecto

```text
gestion-documental-electron/
├─ backend/
│  └─ src/
│     ├─ db/
│     ├─ middleware/
│     ├─ routes/
│     └─ services/
├─ data/
├─ electron/
├─ frontend/
├─ test_docs/
├─ package.json
└─ README.md
```

## Carpetas clave

- `backend/src/db`
  Conexión SQLite e inicialización de tablas.

- `backend/src/routes`
  Endpoints de autenticación, documentos, indexación y carpetas raíz.

- `backend/src/services`
  Lógica de negocio para usuarios, documentos, carpetas raíz e indexación.

- `electron`
  Proceso principal de Electron y arranque de la app.

- `frontend`
  Pantallas HTML, estilos CSS y scripts del cliente.

- `data`
  Base de datos SQLite generada localmente.

- `test_docs`
  Carpeta de prueba para indexación y validaciones manuales.

## Base de datos

Archivo principal:

- `data/app.db`

Tablas principales:

- `users`
- `root_folders`
- `documents`
- `document_history`
- `indexing_runs`

La inicialización de tablas y usuarios semilla se encuentra en:

- `backend/src/db/init.js`

## Respaldo de base de datos

Antes de hacer cambios importantes o pruebas de indexación grandes, conviene respaldar la base de datos.

### Copia manual rápida

```powershell
Copy-Item `
  "d:\sag\segundo trimestre\marzo buscador\gestion-documental-electron\data\app.db" `
  "d:\sag\segundo trimestre\marzo buscador\gestion-documental-electron\data\app-backup.db"
```

### Recomendación práctica

- hacer respaldo antes de pruebas masivas
- conservar al menos una copia diaria si se usa operativamente
- no versionar `app.db` en Git

## Endpoints principales

### Autenticación

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/protected/me`

### Carpetas raíz

- `GET /api/root-folders`
- `POST /api/root-folders`
- `PUT /api/root-folders/:id`
- `DELETE /api/root-folders/:id`

### Documentos

- `GET /api/documents`
- `GET /api/documents/:id`
- `POST /api/documents`
- `PUT /api/documents/:id`
- `GET /api/documents/:id/history`
- `POST /api/documents/:id/open`

### Indexación

- `POST /api/indexing/run`
- `GET /api/indexing/runs`

## Uso básico

### Como administrador

1. Iniciar sesión como `admin`.
2. Registrar una carpeta raíz documental.
3. Ejecutar indexación o crear documentos manualmente.
4. Consultar detalle, historial y edición de documentos.

### Como usuario

1. Iniciar sesión como `user`.
2. Buscar documentos.
3. Ver detalle e historial.
4. Abrir archivos disponibles.

## Empaquetado

El proyecto tiene configurado `electron-builder`.

Para generar paquete:

```powershell
npm run package
```

Salida esperada:

- carpeta `dist/`

Nota:

- el empaquetado existe, pero todavía requiere validación operativa completa antes de considerarse listo para producción

## Troubleshooting

### La app no inicia

Revisar:

- que estés ubicado en la carpeta del proyecto
- que `node_modules` exista
- que ya se haya ejecutado `npm install`

Comandos útiles:

```powershell
pwd
ls
```

### La API no responde en localhost:3000

Verifica:

- que `npm start` esté corriendo
- que no haya otro proceso usando el puerto `3000`

### No se crea la base de datos

Ejecuta:

```powershell
npm run init-db
```

Luego confirma que exista:

- `data/app.db`

### Error al crear un documento

Causas comunes:

- la ruta seleccionada no existe
- el archivo fue movido o borrado
- la carpeta raíz no está bien definida

Solución:

- usar el botón `Explorar archivo`
- verificar que la carpeta raíz esté activa
- revisar que el archivo siga existiendo físicamente

### El usuario no puede ver carpetas raíz

Eso es esperado.

- el endpoint de carpetas raíz es administrativo
- el panel de usuario trabaja sobre búsqueda documental, no sobre administración de carpetas

### El archivo no se abre

Verifica:

- que el archivo exista en la ruta almacenada
- que Windows tenga una aplicación asociada a esa extensión

### Aparece un warning de Electron sobre seguridad

Actualmente puede aparecer un warning relacionado con `Content-Security-Policy`.

Eso no bloquea el funcionamiento local, pero sigue siendo un punto pendiente para endurecimiento antes de producción.

## Estado actual de documentación

Este README describe el flujo real actual del proyecto.
