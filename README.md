# Casa Luz Films

Sitio editorial construido con Astro y Decap CMS. Las películas y el contenido
de portada se guardan como archivos dentro del repositorio.

## Desarrollo local

Requisitos: Node.js 22.12 o posterior y npm 9.6.5 o posterior.

```sh
npm install
npm run dev
```

En otra terminal, desde la raíz del repositorio, inicia el proxy local de Decap:

```sh
npm run cms:proxy
```

Abre `http://localhost:4321/admin/index.html` para editar contenido. En modo
local, Decap guarda los cambios en los archivos del repositorio; el proxy debe
estar activo para usar el CMS.

## Contenido

- Películas: `src/content/films/`
- Equipo: `src/content/people/`
- Portada, About y Contact: `src/content/pages/`
- Imágenes subidas desde el CMS: `public/images/`

Los archivos Markdown se pueden editar desde el panel `/admin/` o directamente
en el repositorio. Las páginas Films y Team y las páginas individuales de
películas e integrantes se generan automáticamente a partir de ese contenido.

## Publicación en Coolify

El proyecto es un sitio estático y está preparado para publicarse en Coolify
usando el `Dockerfile` de la raíz. Coolify construye el frontend con Node y lo
sirve con Nginx en el puerto interno `80`; configura ese puerto como el puerto
del servicio web en Coolify. La terminación HTTPS y el dominio se configuran en
Coolify. Cada publicación genera de nuevo el sitio estático a partir del
contenido actual del repositorio. El panel `/admin/` se incluye en la imagen y
queda disponible en `https://TU-DOMINIO/admin/`.

## Acceso al CMS

El CMS de producción usa el backend GitHub para editar `Noisk8/casaluzfilms` en
la rama `main`. `/admin/` se incluye en la imagen del frontend.

### Servicio OAuth de Coolify

El repositorio también incluye un servicio OAuth para el flujo seguro con GitHub.
En Coolify crea **dos recursos desde el mismo repositorio y rama**:

1. **Frontend:** Dockerfile `Dockerfile` en la raíz, puerto interno `80`, con tu
   dominio público.
2. **OAuth:** Dockerfile `oauth/Dockerfile`, contexto raíz del repositorio,
   puerto interno `8080`. Asígnale un subdominio HTTPS independiente, por
   ejemplo `oauth.tudominio.com`.

En el recurso OAuth configura estas variables. Marca las credenciales como
secretos:

- `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET`: credenciales de la GitHub OAuth
  App.
- `OAUTH_PUBLIC_URL`: URL HTTPS pública del servicio OAuth, sin barra final.
- `ALLOWED_SITE_ORIGINS`: origen exacto del frontend, por ejemplo
  `https://tudominio.com` (sin ruta).
- `STATE_SECRET`: secreto aleatorio de al menos 32 bytes para firmar y validar
  el estado del flujo OAuth.

Crea la GitHub OAuth App en **Settings → Developer settings → OAuth Apps**:

- **Homepage URL:** valor de `OAUTH_PUBLIC_URL`.
- **Authorization callback URL:** `${OAUTH_PUBLIC_URL}/callback`.

En `public/admin/config.yml`, reemplaza
`https://oauth.TU-DOMINIO.com` por el valor de `OAUTH_PUBLIC_URL`. Guarda y
despliega el frontend. No pongas el Client Secret ni `STATE_SECRET` en el
frontend, en `config.yml` ni en Git.

Las cuentas que entren al CMS necesitan permiso de escritura en
`Noisk8/casaluzfilms`. Protege el acceso al servicio OAuth y usa HTTPS en los dos
dominios. El servicio OAuth solo maneja el intercambio de identidad; las
operaciones de contenido las hace Decap directamente contra la API de GitHub.

Para generar `STATE_SECRET`, puedes usar localmente `openssl rand -hex 32` y
pegar el resultado como secreto en Coolify. No compartas ese valor.

Para desarrollo local, `local_backend: true` permite usar el proxy del proyecto:
ejecuta `npm run dev` y, en otra terminal, `npm run cms:proxy`; abre
`http://localhost:4321/admin/index.html`.

## Comandos

- `npm run dev`: servidor de desarrollo
- `npm run build`: compila el sitio estático en `dist/`
- `npm run preview`: sirve localmente la compilación
- `npm run cms:proxy`: proxy de Decap para desarrollo local
