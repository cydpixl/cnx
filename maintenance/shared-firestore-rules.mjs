// Keep every validator inside its deployment scope. Media hosts differ even
// when deployments share a Firebase Authentication project.
export function buildSharedFirestoreRules(baseRules, tenants) {
  const scope = 'match /databases/{database}/documents {';
  const closing = baseRules.lastIndexOf('  }');
  if (!baseRules.includes(scope) || closing < 0) throw Error('Rules structure missing');
  let namespaces = '';
  for (const [tenant, ownRules] of Object.entries(tenants)) {
    if (!['gh', 'rd', 'sg'].includes(tenant)) throw Error('Invalid deployment namespace');
    const own = ownRules.replaceAll('\r\n', '\n');
    const opening = own.indexOf(scope);
    const ending = own.lastIndexOf('  }');
    if (opening < 0 || ending <= opening) throw Error(`Rules structure missing: ${tenant}`);
    const content = own.slice(opening + scope.length, ending)
      .replaceAll('/documents/', `/documents/apps/${tenant}/`);
    namespaces += `\n    match /apps/${tenant} {${content}    }\n`;
  }
  return baseRules.slice(0, closing) + namespaces + baseRules.slice(closing);
}
