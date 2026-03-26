# Gestión Documental - Base local (Electron + Express + SQLite)

## Objetivo
Base inicial de aplicación de escritorio local para gestión documental en Windows:
- Login funcional
- Roles admin/user
- Sesión local segura (cookie httpOnly)
- SQLite local
- **Módulo documental mínimo: indexación, búsqueda, gestión básica**

## Estructura de carpetas

- `/electron` - ejecutable Electron y ventana principal
- `/backend` - API local con Express
  - `/src/db` - conexión SQLite + init (agregadas tablas documentales)
  - `/src/routes` - rutas de auth, protegidas, **root-folders, documents, indexing**
  - `/src/middleware` - JWT auth middleware
  - `/src/services` - lógica de usuarios, **rootFolder, document, indexing**
- `/frontend` - páginas HTML/CSS/JS (actualizadas con UI documental)
- `/data` - base de datos SQLite generada en runtime

## Archivos clave de DB

1. Archivo que crea la base de datos: `backend/src/db/db.js` (abre/crea `data/app.db`).
2. Archivo que crea tabla users: `backend/src/db/init.js` (ejecuta `CREATE TABLE IF NOT EXISTS users`).
3. Archivo que crea tablas documentales: `backend/src/db/init.js` (root_folders, documents, document_history, indexing_runs).
4. Ejecución inicial: `npm run init-db`.
5. Cambios futuros: editar `backend/src/db/init.js` para migraciones/seed, o usar SQLite CLI sobre `data/app.db`.

## Nuevas tablas creadas

- `root_folders`: id, name, absolute_path, is_active, created_at, updated_at
- `documents`: id, original_name, absolute_path, relative_path, root_folder_id, file_extension, file_size, file_hash, file_modified_at, document_date, voucher_number, category, document_type, notes, source_area, status, created_by, updated_by, created_at, updated_at
- `document_history`: id, document_id, action, field_name, old_value, new_value, performed_by, performed_at
- `indexing_runs`: id, started_at, finished_at, status, scanned_files_count, indexed_files_count, updated_files_count, missing_files_count, error_count, notes

## Credenciales de prueba

- admin / admin123 (rol `admin`)
- user / user123 (rol `user`)

## Instalación (una sola vez)

```powershell
cd "d:/sag/segundo trimestre/marzo buscador/gestion-documental-electron"
npm install
npm run init-db
```

## Ejecución (desarrollo)

```powershell
cd "d:/sag/segundo trimestre/marzo buscador/gestion-documental-electron"
npm run dev
```

- Abre Electron.
- Backend arranca automático (`backend/src/server.js` en puerto `3000`).
- Interfaz carga `frontend/index.html`.
- Desde navegador (opcional) también puedes usar `http://localhost:3000`.

## Nuevos endpoints API

### Root Folders (admin)
- `GET /api/root-folders`
- `POST /api/root-folders` { name, absolutePath }
- `PUT /api/root-folders/:id` { name, absolutePath, isActive }
- `DELETE /api/root-folders/:id`

### Indexing (admin)
- `POST /api/indexing/run`
- `GET /api/indexing/runs`

### Documents
- `GET /api/documents` (con filtros: ?name=...&voucher=...&rootFolderId=...)
- `GET /api/documents/:id`
- `POST /api/documents` (admin) { originalName, absolutePath, ... }
- `PUT /api/documents/:id` (admin) { updates }
- `GET /api/documents/:id/history`
- `POST /api/documents/:id/open` (registra apertura)

## Seguridad implementada

- bcrypt para hash de contraseña.
- Validación de campos vacíos.
- Rutas protegidas con JWT en cookie httpOnly.
- Middleware `requireRole('admin')` para endpoints sensibles.
- Manejo básico de errores.

## Módulo documental implementado

- **Configuración carpetas raíz**: Admin agrega/lista/activa/desactiva/elimina carpetas documentales.
- **Indexación**: Escanea carpetas activas, indexa archivos en DB, evita duplicados por hash, actualiza si cambió, marca missing si desapareció.
- **Búsqueda**: Filtrar por nombre, voucher, carpeta raíz, etc.
- **Gestión**: Ver detalle, abrir archivo local, editar metadatos (admin), crear nuevo documento (admin, copia archivo a carpeta destino).
- **Historial**: Básico por documento (indexed, created, updated, opened, marked_missing).
- **Roles**: Admin todo, User solo leer/buscar/abrir/ver historial.

## Próxima fase preparada

- Agregar OCR en indexación.
- IA para categorización automática.
- Subida remota.
- Sincronización.
- Versionado avanzado.
- Visor PDF integrado.

## Archivos modificados

- `backend/src/db/init.js`: Agregadas tablas documentales.
- `backend/src/server.js`: Incluidas nuevas rutas.
- `frontend/admin.html`: Agregada UI completa para admin (carpetas, indexación, documentos, crear/editar).
- `frontend/user.html`: Agregada UI para user (listado, búsqueda, detalle, abrir, historial).
- `frontend/styles.css`: Agregados estilos para filtros y modal.
- `package.json`: Agregado multer (para futuras subidas).

## Archivos nuevos

- `backend/src/services/rootFolderService.js`
- `backend/src/services/documentService.js`
- `backend/src/services/indexingService.js`
- `backend/src/routes/rootFolders.js`
- `backend/src/routes/documents.js`
- `backend/src/routes/indexing.js`

## Estructura de carpetas

- `/electron` - ejecutable Electron y ventana principal
- `/backend` - API local con Express
  - `/src/db` - conexión SQLite + init
  - `/src/routes` - rutas de auth y protegidas
  - `/src/middleware` - JWT auth middleware
  - `/src/services` - lógica de usuarios
- `/frontend` - páginas HTML/CSS/JS
- `/data` - base de datos SQLite generada en runtime

## Archivos clave de DB

1. Archivo que crea la base de datos: `backend/src/db/db.js` (abre/crea `data/app.db`).
2. Archivo que crea tabla `users`: `backend/src/db/init.js` (ejecuta `CREATE TABLE IF NOT EXISTS users`).
3. Archivo que inserta usuarios iniciales: `backend/src/db/init.js` (seed `admin` + `user`).
4. Ejecución inicial: `npm run init-db`.
5. Cambios futuros: editar `backend/src/db/init.js` para estructura/seed, o usar SQLite CLI sobre `data/app.db`.

## Credenciales de prueba

- admin / admin123 (rol `admin`)
- user / user123 (rol `user`)

## Instalación (una sola vez)

```powershell
cd "d:/sag/segundo trimestre/marzo buscador/gestion-documental-electron"
npm install
npm run init-db
```

## Ejecución (desarrollo)

```powershell
npm run dev
```

Esto abre ventana Electron y carga `frontend/index.html`.

## Ruta API local

`http://localhost:3000/api`

### Endpoints
- `POST /api/auth/login` { username, password }
- `POST /api/auth/logout`
- `GET /api/protected/me` (token httpOnly)

## Pruebas de login

1. Abre app.
2. Ingresa `admin` / `admin123` → redirige `admin.html`.
3. Ingresa `user` / `user123` → redirige `user.html`.
4. Presiona logout y vuelve a login.

## Seguridad implementada

- bcrypt para hash de contraseña (en `backend/src/db/init.js` y `backend/src/services/userService.js`).
- Validación de campos vacíos en frontend (`frontend/app.js`) y backend (`backend/src/routes/auth.js`).
- Rutas protegidas con JWT en cookie httpOnly (`backend/src/middleware/authMiddleware.js`).
- Manejo básico de errores en middleware de Express y en login.

## Siguiente fase: adición de módulos documentales

- El backend puede crecer con nuevas rutas dentro de `/backend/src/routes`.
- El frontend puede agregar páginas y lógica en `/frontend`.
- Mantener la misma base `verifyToken` para permisos.
