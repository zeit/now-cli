export default function getInspectUrl(deploymentUrl: string, orgSlug: string) {
  const url = deploymentUrl.replace('https://', '');

  // example urls:
  // lucim-fyulaijvg.now.sh
  // s-66p6vb23x.n8.io (custom domain suffix)
  const [sub, ...p] = url.split('.');
  const apex = p.join('.');

  const q = sub.split('-');
  const deploymentShortId = q.pop();
  const projectName = q.join('-');

  const inspectUrl = `https://vercel.com/${orgSlug}/${projectName}/${deploymentShortId}${
    apex !== 'now.sh' && apex !== 'vercel.app' ? `/${apex}` : ''
  }`;

  return inspectUrl;
}
