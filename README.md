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

Abre `http://localhost:4321/admin/local.html` para editar contenido. Esa página
usa la configuración local de Decap y guarda los cambios mediante el proxy en
los archivos del repositorio. El proxy debe estar activo.

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
queda disponible en `https://ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io/admin/`.

## Acceso al CMS

El CMS de producción usa el backend GitHub para editar `Noisk8/casaluzfilms` en
la rama `main`. `/admin/` se incluye en la imagen del frontend.

### Servicio OAuth de Coolify

El repositorio también incluye un servicio OAuth para el flujo seguro con GitHub.
En Coolify crea **dos recursos desde el mismo repositorio y rama**:

1. **Frontend:** Dockerfile `Dockerfile` en la raíz, puerto interno `80`, con tu
   dominio `ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io`.
2. **OAuth:** Dockerfile `oauth/Dockerfile`, contexto raíz del repositorio,
   puerto interno `8080`. Asígnale el dominio
   `oauth-ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io`.

En el recurso OAuth configura estas variables. Marca las credenciales como
secretos:

- `GITHUB_CLIENT_ID` y `GITHUB_CLIENT_SECRET`: credenciales de la GitHub OAuth
  App.
- `OAUTH_PUBLIC_URL`: `https://oauth-ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io`
- `ALLOWED_SITE_ORIGINS`: `https://ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io`
- `STATE_SECRET`: secreto aleatorio de al menos 32 bytes para firmar y validar
  el estado del flujo OAuth.

Crea la GitHub OAuth App en **Settings → Developer settings → OAuth Apps**:

- **Homepage URL:** `https://oauth-ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io`
- **Authorization callback URL:**
  `https://oauth-ivbw8fhjh51v3ec3vkiyy6pr.181.135.91.136.sslip.io/callback`

El `base_url` del CMS ya está configurado con el dominio OAuth previsto.
Confirma que Coolify asigne esos dominios y habilite HTTPS antes de crear la
GitHub OAuth App. Si Coolify genera otros dominios, actualiza estas variables,
el callback y `base_url` para que coincidan. No pongas el Client Secret ni
`STATE_SECRET` en el frontend, en `config.yml` ni en Git.

Las cuentas que entren al CMS necesitan permiso de escritura en
`Noisk8/casaluzfilms`. Protege el acceso al servicio OAuth y usa HTTPS en los dos
dominios. El servicio OAuth solo maneja el intercambio de identidad; las
operaciones de contenido las hace Decap directamente contra la API de GitHub.

Para generar `STATE_SECRET`, puedes usar localmente `openssl rand -hex 32` y
pegar el resultado como secreto en Coolify. No compartas ese valor.

En desarrollo local, `local_backend: true` está aislado a `/admin/local.html`;
ejecuta `npm run dev` y, en otra terminal, `npm run cms:proxy`. La configuración
local y su página se excluyen de la imagen de Coolify para que el CMS publicado
siempre use OAuth y GitHub.

## Comandos

- `npm run dev`: servidor de desarrollo
- `npm run build`: compila el sitio estático en `dist/`
- `npm run preview`: sirve localmente la compilación
- `npm run cms:proxy`: proxy de Decap para desarrollo local
